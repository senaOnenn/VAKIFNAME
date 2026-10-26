"""PyTorch'suz, ONNX Runtime ile yerel modeller (e5 kodlayıcı ve cross-encoder).

- Yalnızca `onnxruntime`, `tokenizers` ve `numpy` gerekir; torch/sentence-transformers yüklenmez (bellek tasarrufu).
- Model dosyaları yerel klasörden okunur; ağdan indirme yapılmaz. Klasördeki `VAKIFNAME_PROVENANCE.json` kayıtlı model
  kimliğini ve dosya özetlerini taşır; özet uyuşmazsa model yüklenmez.
- Oturumlar tek iş parçacığıyla çalışır: aynı sunucudaki 8765 ile CPU rekabeti en aza iner.
"""

import hashlib
import json
import os
import threading
from pathlib import Path
from typing import Optional

from .index import MODEL_ID, PASSAGE_PREFIX, QUERY_PREFIX, SemanticUnavailable

MAX_TOKENS = 512


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _session(path: Path, threads: int):
    try:
        import onnxruntime as ort
    except ImportError as e:
        raise SemanticUnavailable("onnxruntime kurulu değil") from e
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(str(path), sess_options=so, providers=["CPUExecutionProvider"])


_TOKENIZERS: dict[str, object] = {}
_TOK_LOCK = threading.Lock()


def _tokenizer(model_dir: Path):
    """Sözlüğe (sentencepiece.bpe.model özeti) göre paylaşılan tokenizer. e5 ile cross-encoder aynı XLM-R sözlüğünü
    kullanır; tokenizer.json yüklenince ~280 MB yer kapladığı için tek örnek tutulur."""
    try:
        from tokenizers import Tokenizer
    except ImportError as e:
        raise SemanticUnavailable("tokenizers kurulu değil") from e
    spm = model_dir / "sentencepiece.bpe.model"
    key = _sha(spm) if spm.is_file() else str(model_dir)
    with _TOK_LOCK:
        if key not in _TOKENIZERS:
            _TOKENIZERS[key] = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        return _TOKENIZERS[key]


def _batch(np, encodings):
    """Elle dolgu (pad=1) ve 512 parça sınırı; paylaşılan tokenizer'ın ayarları değiştirilmez."""
    seqs = [e.ids[:MAX_TOKENS] for e in encodings]
    width = max(len(x) for x in seqs)
    ids = np.full((len(seqs), width), 1, dtype=np.int64)
    mask = np.zeros((len(seqs), width), dtype=np.int64)
    for i, x in enumerate(seqs):
        ids[i, :len(x)] = x
        mask[i, :len(x)] = 1
    return ids, mask


def _threads() -> int:
    return max(1, int(os.environ.get("VAKIFNAME_ASK_THREADS", "1")))


class OnnxEncoder:
    """multilingual-e5-small, ONNX (isteğe göre INT8). `LocalEncoder` ile aynı arayüz: passages / query / fingerprint."""

    def __init__(self, model_dir: Path, onnx_file: str = "onnx/model_int8_u8.onnx", expected_sha256: Optional[str] = None):
        import numpy as np

        self.model_dir = Path(model_dir)
        prov = json.loads((self.model_dir / "VAKIFNAME_PROVENANCE.json").read_text(encoding="utf-8"))
        if prov.get("repo_id") != MODEL_ID:
            raise SemanticUnavailable("Beklenmeyen model.")
        path = self.model_dir / onnx_file
        if not path.is_file():
            raise SemanticUnavailable(f"ONNX modeli yok: {onnx_file}")
        digest = _sha(path)
        if expected_sha256 and digest != expected_sha256:
            raise SemanticUnavailable("ONNX model dosyası beklenen özetle uyuşmuyor.")
        self._np = np
        self._sess = _session(path, _threads())
        self._tok = _tokenizer(self.model_dir)
        self._lock = threading.Lock()
        import onnxruntime
        self.fingerprint = {"model_id": MODEL_ID, "revision": prov.get("revision"), "runtime": "onnxruntime",
                            "onnx_file": onnx_file, "onnx_sha256": digest, "onnxruntime": onnxruntime.__version__,
                            "passage_prefix": PASSAGE_PREFIX, "query_prefix": QUERY_PREFIX, "normalize": True, "pooling": "mean"}

    def _encode(self, texts: list[str]):
        np = self._np
        out = []
        for i in range(0, len(texts), 16):
            ids, mask = _batch(np, self._tok.encode_batch(texts[i:i + 16]))
            with self._lock:
                hidden = self._sess.run(None, {"input_ids": ids, "attention_mask": mask,
                                               "token_type_ids": np.zeros_like(ids)})[0]
            m = mask[..., None].astype(np.float32)
            v = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
            out.append(v / np.linalg.norm(v, axis=1, keepdims=True))
        return np.concatenate(out).astype(np.float32)

    def passages(self, texts: list[str]):
        return self._encode([PASSAGE_PREFIX + t for t in texts])

    def query(self, text: str):
        return self._encode([QUERY_PREFIX + text])[0]


class OnnxCrossEncoder:
    """cross-encoder/mmarco-mMiniLMv2-L12-H384-v1 (ONNX INT8): soru–metin çifti için ilgililik puanı (logit)."""

    REPO = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"

    def __init__(self, model_dir: Path, onnx_file: str = "onnx/model_quint8_avx2.onnx"):
        import numpy as np

        self.model_dir = Path(model_dir)
        prov = json.loads((self.model_dir / "VAKIFNAME_PROVENANCE.json").read_text(encoding="utf-8"))
        if prov.get("repo_id") != self.REPO or prov.get("trust_remote_code") is not False:
            raise SemanticUnavailable("Beklenmeyen cross-encoder.")
        path = self.model_dir / onnx_file
        expected = (prov.get("files_sha256") or {}).get(onnx_file)
        if not path.is_file() or (expected and _sha(path) != expected):
            raise SemanticUnavailable("Cross-encoder dosyası köken kaydıyla uyuşmuyor.")
        self._np = np
        self._sess = _session(path, _threads())
        self._inputs = {i.name for i in self._sess.get_inputs()}
        self._tok = _tokenizer(self.model_dir)
        self._lock = threading.Lock()
        self.fingerprint = {"model_id": self.REPO, "revision": prov.get("revision"), "onnx_file": onnx_file}

    def scores(self, question: str, passages: list[str]) -> list[float]:
        if not passages:
            return []
        np = self._np
        ids, mask = _batch(np, self._tok.encode_batch([(question, p) for p in passages]))
        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self._inputs:
            feed["token_type_ids"] = np.zeros_like(feed["input_ids"])
        with self._lock:
            logits = self._sess.run(None, feed)[0]
        return [float(x) for x in np.asarray(logits).reshape(-1)]
