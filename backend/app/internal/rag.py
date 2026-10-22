"""Dahili RAG teslim paketi (V3 çekirdek + FAISS) için doğrulamalı adaptör.

- Paket kodu çalıştırılmadan önce her dosyanın SHA-256 değeri teslim manifestiyle karşılaştırılır.
- İndeksteki belgeler V20'nin 80 ana olgusuyla birebir aynı olmalıdır; aday kayıtlar indekste olamaz.
- Her atıf V20 kataloğuyla (kaynak PDF ve fiziksel sayfa) yeniden doğrulanır.
- Embedding modeli yalnızca yerel bir klasörden yüklenir; ağdan indirme yapılmaz. Model yoksa
  anlamsal arama gerektiren sorular kaynak göstermeden `retrieval_unavailable` döner.
- Anlamsal arama kullanıldığında indeks vektörleri yerel modelle bir kez yeniden kodlanıp karşılaştırılır.
  Kosinüs benzerliği eşiğin altındaysa cevaplar `embedding_index_mismatch` uyarısı taşır; indeks
  hiçbir zaman otomatik olarak yeniden üretilmez.
- Cevaplar LLM ile üretilmez (`source_based_no_llm`); içerik harici servislere gönderilmez.
"""

import importlib.util
import json
import os
import threading
from pathlib import Path
from typing import Optional

from .catalog import V20Catalog, sha256_file

HANDOFF_MANIFEST = "handoff_manifest.json"
SERVICE_FILE = "vakifname_rag_service_v1_dev.py"
KNOWLEDGE_BASE_FILE = "vakifname_knowledge_base_v20_dev.json"
EMBEDDING_MODEL = "intfloat/multilingual-e5-small"
# Aynı model ve aynı belge metniyle üretilmiş bir indeks için beklenen en düşük kosinüs benzerliği.
INDEX_COMPAT_MIN_COSINE = 0.999


class RagUnavailableError(RuntimeError):
    """RAG paketi veya bağımlılıkları kullanılamıyor."""


class RagIntegrityError(RuntimeError):
    """RAG paketi V20 kataloğu veya teslim manifestiyle uyuşmuyor."""


class EmbeddingUnavailableError(RuntimeError):
    """Yerel embedding modeli yok; anlamsal arama yapılamaz."""


class OfflineEncoder:
    """SentenceTransformer'ı yalnızca yerel klasörden, ilk kullanımda yükler. Asla ağdan indirmez."""

    def __init__(self, model_dir: Optional[Path]):
        self.model_dir = Path(model_dir) if model_dir else None
        self._model = None

    def encode(self, *args, **kwargs):
        if self._model is None:
            if self.model_dir is None or not self.model_dir.is_dir():
                raise EmbeddingUnavailableError("Yerel embedding modeli yapılandırılmadı.")
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(str(self.model_dir), device="cpu", local_files_only=True)
        return self._model.encode(*args, **kwargs)


class _UsageTrackingEncoder:
    """Bir sorunun anlamsal aramaya gidip gitmediğini anlamak için encoder çağrılarını işaretler."""

    def __init__(self, inner):
        self.inner = inner
        self.used = False

    def encode(self, *args, **kwargs):
        self.used = True
        return self.inner.encode(*args, **kwargs)


def verify_runtime(runtime_dir: Path) -> dict:
    """Teslim manifestindeki bütün dosyaların SHA-256 değerlerini doğrular."""
    manifest = json.loads((runtime_dir / HANDOFF_MANIFEST).read_text(encoding="utf-8"))
    for name, digest in manifest["file_sha256"].items():
        path = runtime_dir / name
        if path.resolve().parent != runtime_dir.resolve() or not path.is_file() or path.is_symlink():
            raise RagIntegrityError(f"RAG paket dosyası eksik veya geçersiz: {name}")
        if sha256_file(path) != digest:
            raise RagIntegrityError(f"RAG paket dosyası değiştirilmiş: {name}")
    if manifest.get("public_rag_enabled") is not False or manifest.get("publication_status") != "blocked":
        raise RagIntegrityError("RAG paketi yayına kapalı olarak işaretlenmemiş.")
    return manifest


class InternalRag:
    def __init__(self, runtime_dir: Path, catalog: V20Catalog, expected_kb_sha256: str, encoder=None):
        self.runtime_dir = Path(runtime_dir)
        self.catalog = catalog
        verify_runtime(self.runtime_dir)
        if sha256_file(self.runtime_dir / KNOWLEDGE_BASE_FILE) != expected_kb_sha256:
            raise RagIntegrityError("RAG paketindeki bilgi tabanı V20 freeze sürümü değil.")

        spec = importlib.util.spec_from_file_location("vakifname_internal_rag_service", self.runtime_dir / SERVICE_FILE)
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
            self._encoder = _UsageTrackingEncoder(encoder or OfflineEncoder(None))
            self._service = module.VakifnameService(self.runtime_dir, encoder=self._encoder)
        except ImportError as e:
            raise RagUnavailableError(f"RAG bağımlılığı eksik: {e.name}") from e
        self._verify_index()
        self._index_compat: Optional[dict] = None
        self._ask_lock = threading.Lock()

    def _verify_index(self):
        docs = self._service.core.docs
        fact_ids = [d["fact_id"] for d in docs]
        if set(fact_ids) != set(self.catalog.facts) or len(fact_ids) != len(self.catalog.facts):
            raise RagIntegrityError("RAG indeksi V20 ana olgularıyla birebir eşleşmiyor.")
        if set(fact_ids) & set(self.catalog.drafts) or any(f.startswith("DRAFT-") for f in fact_ids):
            raise RagIntegrityError("RAG indeksinde karantinadaki aday kayıt var.")
        for d in docs:
            src = self.catalog.facts[d["fact_id"]].source
            if (d["source"]["book"], d["source"]["pdf_page"]) != (src.source_file, src.pdf_physical_page):
                raise RagIntegrityError(f"{d['fact_id']}: RAG kaynak sayfası V20 ile uyuşmuyor.")
            if d["public_answer_eligible"] is not False or d["publication_status"] != "blocked":
                raise RagIntegrityError(f"{d['fact_id']}: RAG belgesi yayına kapalı değil.")

    @property
    def indexed_fact_ids(self) -> list[str]:
        return [d["fact_id"] for d in self._service.core.docs]

    @property
    def index_compatibility(self) -> Optional[dict]:
        """Son hesaplanan model/indeks uyumluluğu; anlamsal arama henüz kullanılmadıysa None."""
        return self._index_compat

    def check_index_compatibility(self) -> dict:
        """İndeksteki belge vektörlerini yerel modelle yeniden kodlar ve karşılaştırır (yalnızca okuma)."""
        if self._index_compat is None:
            import numpy as np

            core = self._service.core
            stored = core.index.reconstruct_n(0, core.index.ntotal)
            encoded = np.asarray(self._encoder.inner.encode(
                ["passage: " + d["search_text"] for d in core.docs],
                convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False,
            ), dtype=np.float32)
            cosine = (stored * encoded).sum(axis=1)
            self_match = int(((encoded @ stored.T).argmax(axis=1) == np.arange(len(core.docs))).sum())
            self._index_compat = {
                "compatible": bool(cosine.min() >= INDEX_COMPAT_MIN_COSINE),
                "min_cosine": round(float(cosine.min()), 6),
                "mean_cosine": round(float(cosine.mean()), 6),
                "self_match": self_match,
                "documents": len(core.docs),
                "threshold": INDEX_COMPAT_MIN_COSINE,
            }
        return self._index_compat

    def ask(self, question: str) -> dict:
        with self._ask_lock:
            return self._ask(question)

    def _ask(self, question: str) -> dict:
        self._encoder.used = False
        try:
            result = self._service.ask(question)
        except EmbeddingUnavailableError:
            return {
                "question": question,
                "status": "retrieval_unavailable",
                "answer": "Anlamsal arama için yerel embedding modeli yüklü değil; kaynak gösterilemiyor.",
                "citations": [],
                "warnings": [],
                "answer_method": "source_based_no_llm",
                "internal_test_only": True,
                "public_answer_eligible": False,
                "publication_status": "blocked",
            }
        for c in result["citations"]:
            fact = self.catalog.facts.get(c["fact_id"])
            if fact is None:
                raise RagIntegrityError(f"Katalogda olmayan atıf: {c['fact_id']}")
            if (c["pdf_file"], c["pdf_page"]) != (fact.source.source_file, fact.source.pdf_physical_page):
                raise RagIntegrityError(f"{c['fact_id']}: atıf sayfası V20 ile uyuşmuyor.")
            c["pdf_page_kind"] = "physical"
            c["open_issue_ids"] = list(fact.open_issue_ids)
        if result["public_answer_eligible"] is not False or result["publication_status"] != "blocked":
            raise RagIntegrityError("RAG cevabı yayına kapalı değil.")
        if self._encoder.used:
            compat = self.check_index_compatibility()
            result["retrieval_reliable"] = compat["compatible"]
            if not compat["compatible"]:
                result["warnings"].append("embedding_index_mismatch")
        return result
