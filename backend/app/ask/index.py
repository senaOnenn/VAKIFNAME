"""Yerel embedding modeliyle yayımlanmış olgular için vektör dizini ve manifesti.

- Model yalnızca yerel klasörden yüklenir; ağdan indirme yapılmaz. Model dosyasının SHA-256 değeri klasördeki
  `VAKIFNAME_PROVENANCE.json` ile karşılaştırılır; uyuşmazsa anlamsal arama kapatılır (kelime araması sürer).
- Dizin, katalog SHA-256 değerine bağlıdır. Manifest; katalog özeti, model kimliği ve revizyonu, kütüphane sürümleri,
  belge kimlikleri ve metin özeti ile vektör dosyasının SHA-256 değerini tutar. Herhangi biri değişirse dizin aynı
  modelle baştan üretilir; eski dizin yeni katalogla birlikte kullanılmaz.
- Dosyalar geçici adla yazılıp `os.replace` ile yerine konur (yarım dizin okunmaz).
"""

import hashlib
import json
import logging
import os
import threading
from pathlib import Path
from typing import Optional

from .engine import Corpus

logger = logging.getLogger("vakifname.ask")

MODEL_ID = "intfloat/multilingual-e5-small"
PASSAGE_PREFIX = "passage: "
QUERY_PREFIX = "query: "
MANIFEST = "manifest.json"
SCHEMA = "vakifname.ask_index/1"


class SemanticUnavailable(RuntimeError):
    pass


def _sha_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


class LocalEncoder:
    """SentenceTransformer'ı yalnızca yerel klasörden yükler ve köken kaydını doğrular."""

    def __init__(self, model_dir: Path):
        self.model_dir = Path(model_dir)
        prov_path = self.model_dir / "VAKIFNAME_PROVENANCE.json"
        if not prov_path.is_file():
            raise SemanticUnavailable("Model köken kaydı yok.")
        prov = json.loads(prov_path.read_text(encoding="utf-8"))
        if prov.get("repo_id") != MODEL_ID:
            raise SemanticUnavailable("Beklenmeyen model.")
        weights = self.model_dir / "model.safetensors"
        if not weights.is_file() or _sha_file(weights) != prov.get("model_safetensors_sha256"):
            raise SemanticUnavailable("Model dosyası köken kaydıyla uyuşmuyor.")
        try:
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
            import numpy as np
            import sentence_transformers
            import torch
            import transformers
            from sentence_transformers import SentenceTransformer
        except ImportError as e:
            raise SemanticUnavailable(f"Embedding kütüphanesi kurulu değil: {e.name}") from e
        # Varsayılan tek iş parçacığı: kısa sorgu kodlamada belirgin yavaşlama yok, aynı sunucudaki 8765 ile CPU rekabeti azalır.
        torch.set_num_threads(max(1, int(os.environ.get("VAKIFNAME_ASK_THREADS", "1"))))
        self._np = np
        self._model = SentenceTransformer(str(self.model_dir), device="cpu", local_files_only=True)
        self._lock = threading.Lock()
        self.fingerprint = {
            "model_id": MODEL_ID, "revision": prov.get("revision"), "weights_sha256": prov["model_safetensors_sha256"],
            "sentence_transformers": sentence_transformers.__version__, "transformers": transformers.__version__,
            "torch": torch.__version__, "numpy": np.__version__,
            "passage_prefix": PASSAGE_PREFIX, "query_prefix": QUERY_PREFIX, "normalize": True,
        }

    def _encode(self, texts: list[str]):
        with self._lock:
            v = self._model.encode(texts, convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False,
                                   batch_size=16)
        return self._np.asarray(v, dtype=self._np.float32)

    def passages(self, texts: list[str]):
        return self._encode([PASSAGE_PREFIX + t for t in texts])

    def query(self, text: str):
        return self._encode([QUERY_PREFIX + text])[0]


def _docs_digest(corpus: Corpus) -> str:
    payload = [[d.fact_id, d.passage] for d in corpus.docs]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False).encode()).hexdigest()


def build_vectors(corpus: Corpus, encoder, index_dir: Optional[Path]):
    """Dizini yükler veya üretir. `index_dir` yoksa yalnızca bellekte üretilir."""
    import numpy as np

    expected = {
        "schema": SCHEMA, "catalog_sha256": corpus.sha256, "model": encoder.fingerprint,
        "document_ids": [d.fact_id for d in corpus.docs], "documents_sha256": _docs_digest(corpus),
    }
    if index_dir is not None:
        index_dir = Path(index_dir)
        manifest_path = index_dir / MANIFEST
        if manifest_path.is_file():
            try:
                m = json.loads(manifest_path.read_text(encoding="utf-8"))
                vec_path = index_dir / m["vectors_file"]
                if all(m.get(k) == v for k, v in expected.items()) and vec_path.is_file() and \
                        _sha_file(vec_path) == m["vectors_sha256"]:
                    vectors = np.load(vec_path, allow_pickle=False)
                    if vectors.shape == (len(corpus.docs), m["dimension"]):
                        return vectors, m
            except (OSError, ValueError, KeyError) as e:
                logger.warning("Esere Sor dizini okunamadı, yeniden üretilecek: %s", e)
    vectors = encoder.passages([d.passage for d in corpus.docs]) if corpus.docs else np.zeros((0, 384), np.float32)
    vec_sha = hashlib.sha256(vectors.tobytes()).hexdigest()
    manifest = {**expected, "dimension": int(vectors.shape[1]) if vectors.ndim == 2 else 0, "count": len(corpus.docs),
                "vectors_file": f"vectors-{corpus.sha256[:16]}.npy", "vectors_sha256": None, "vectors_bytes_sha256": vec_sha}
    if index_dir is not None:
        index_dir.mkdir(parents=True, exist_ok=True)
        vec_path = index_dir / manifest["vectors_file"]
        tmp = vec_path.with_suffix(".npy.tmp")
        with tmp.open("wb") as f:
            np.save(f, vectors, allow_pickle=False)
        os.replace(tmp, vec_path)
        manifest["vectors_sha256"] = _sha_file(vec_path)
        tmp_m = index_dir / (MANIFEST + ".tmp")
        tmp_m.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp_m, index_dir / MANIFEST)
        for old in index_dir.glob("vectors-*.npy"):
            if old.name != manifest["vectors_file"]:
                old.unlink(missing_ok=True)
        logger.info("Esere Sor dizini üretildi: %d olgu, katalog %s.", len(corpus.docs), corpus.sha256[:12])
    return vectors, manifest
