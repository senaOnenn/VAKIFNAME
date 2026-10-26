"""Genel API için Esere Sor servisi: katalog değişince motoru güvenle yeniler.

Katalog her değiştiğinde önce kelime aramalı yeni bir motor hemen devreye girer (eski katalogun olguları anında
kaybolur). Anlamsal vektörler arka planda aynı katalog için üretilir ve yalnızca o katalogun motoruna bağlanır; bu sırada
katalog yeniden değişirse eski vektörler atılır.
"""

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from ..public_catalog import PublicCatalog, PublicCatalogRepository
from .engine import Corpus, Engine
from .index import LocalEncoder, SemanticUnavailable, build_vectors

logger = logging.getLogger("vakifname.ask")


def make_encoder(model_dir: Path, runtime: Optional[str] = None, onnx_file: Optional[str] = None):
    """`runtime`: "torch" (sentence-transformers) veya "onnx" (onnxruntime, torch yüklenmez)."""
    runtime = runtime or os.environ.get("VAKIFNAME_ASK_RUNTIME", "torch")
    if runtime == "onnx":
        from .onnx_models import OnnxEncoder
        return OnnxEncoder(model_dir, onnx_file or os.environ.get("VAKIFNAME_ASK_ONNX_FILE", "onnx/model_int8_u8.onnx"))
    return LocalEncoder(model_dir)


def make_cross_encoder(ce_dir: Optional[Path]):
    if ce_dir is None:
        return None
    from .onnx_models import OnnxCrossEncoder
    return OnnxCrossEncoder(Path(ce_dir))


def build_engine(catalog: PublicCatalog, model_dir: Optional[Path] = None, index_dir: Optional[Path] = None,
                 encoder=None, cross_encoder=None, runtime: Optional[str] = None, word_check=None) -> Engine:
    """Eşzamanlı kurulum (ölçüm ve testler için). Model yoksa kelime aramalı motor döner."""
    corpus = Corpus(catalog, word_check)
    if encoder is None and model_dir is not None:
        encoder = make_encoder(model_dir, runtime)
    if encoder is None:
        return Engine(corpus, cross_encoder=cross_encoder)
    vectors, _ = build_vectors(corpus, encoder, index_dir)
    return Engine(corpus, encoder.query, vectors, cross_encoder=cross_encoder)


class AskService:
    def __init__(self, repo: PublicCatalogRepository, model_dir: Optional[Path] = None, index_dir: Optional[Path] = None,
                 encoder=None, background: bool = True, cross_encoder_dir: Optional[Path] = None, cross_encoder=None):
        self.repo = repo
        self.model_dir = Path(model_dir) if model_dir else None
        self.index_dir = Path(index_dir) if index_dir else None
        self._encoder = encoder
        self.cross_encoder_dir = Path(cross_encoder_dir) if cross_encoder_dir else None
        self._cross_encoder = cross_encoder
        # Genel Türkçe sözcük denetimi (`TurkishLexicon.is_word`); uygulama rehber sözlüğü yüklenince bağlar.
        self.word_check = None
        self._ce_state = "ready" if cross_encoder is not None else ("pending" if self.cross_encoder_dir else "disabled")
        self._semantic_state = "ready" if encoder is not None else ("pending" if self.model_dir else "disabled")
        self._semantic_error: Optional[str] = None
        self._manifest: Optional[dict] = None
        self._lock = threading.Lock()
        self._catalog = None
        self._engine: Optional[Engine] = None
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="esere-sor") if background else None

    def engine(self) -> Engine:
        catalog = self.repo.catalog
        with self._lock:
            if catalog is self._catalog and self._engine is not None:
                return self._engine
            corpus = Corpus(catalog, self.word_check)
            self._engine, self._catalog, self._manifest = Engine(corpus), catalog, None
        if self._semantic_state in ("pending", "ready"):
            if self._pool is not None:
                self._pool.submit(self._attach_semantic, corpus)
            else:
                self._attach_semantic(corpus)
        return self._engine

    def _attach_semantic(self, corpus: Corpus):
        try:
            if self._encoder is None:
                self._encoder = make_encoder(self.model_dir)
            vectors, manifest = build_vectors(corpus, self._encoder, self.index_dir)
            if self._ce_state == "pending":
                try:
                    self._cross_encoder = make_cross_encoder(self.cross_encoder_dir)
                    self._ce_state = "ready"
                except Exception as e:  # noqa: BLE001 — cross-encoder yoksa CE'siz doğrulama sürer
                    self._ce_state = "disabled"
                    logger.warning("Cross-encoder yüklenemedi, CE'siz doğrulama kullanılıyor: %s", e)
        except SemanticUnavailable as e:
            self._semantic_state, self._semantic_error = "disabled", str(e)
            logger.warning("Esere Sor anlamsal araması kapalı, kelime araması kullanılıyor: %s", e)
            return
        except Exception as e:  # noqa: BLE001 — model hatası servisi düşürmez
            self._semantic_state, self._semantic_error = "failed", type(e).__name__
            logger.exception("Esere Sor dizini üretilemedi; kelime araması kullanılıyor.")
            return
        with self._lock:
            if self._engine is not None and self._engine.corpus is corpus:
                self._engine = Engine(corpus, self._encoder.query, vectors, cross_encoder=self._cross_encoder)
                self._manifest = manifest
                self._semantic_state = "ready"

    def status(self) -> dict:
        eng = self.engine()
        m = self._manifest
        return {
            "retrieval": eng.retrieval, "semantic": self._semantic_state, "cross_encoder": self._ce_state,
            "verifier": eng.verifier.method, "facts_indexed": len(eng.corpus.docs),
            "monuments": len(eng.corpus.monuments), "catalog_sha256": eng.corpus.sha256,
            "index": None if m is None else {
                "catalog_sha256": m["catalog_sha256"], "count": m["count"], "model_id": m["model"]["model_id"],
                "model_revision": m["model"]["revision"], "vectors_sha256": m.get("vectors_bytes_sha256"),
            },
            "answer_method": "approved_text_retrieval",
        }
