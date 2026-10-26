"""Yetkili dahili katalog ve RAG test API'si.

Genel API'den (`app.main`) tamamen ayrı bir uygulamadır; genel uygulamaya hiçbir rota eklemez.
- Yalnızca loopback istemcilerini kabul eder (aksi halde 403).
- Her istek `X-Internal-Token` başlığı ister (aksi halde 401). Anahtar yalnızca sunucu tarafında,
  `VAKIFNAME_INTERNAL_TOKEN` ortam değişkeninde tutulur; frontend'e konmaz.
- CORS middleware'i yoktur: tarayıcıdaki başka origin'ler bu API'yi çağıramaz.
- OpenAPI/dokümantasyon sayfaları kapalıdır.
- Görsel veya PDF dosyası sunmaz; yalnızca meta veri döner.

Çalıştırma (yalnızca 127.0.0.1):

    VAKIFNAME_INTERNAL_TOKEN=... python -m app.internal.server --port 8765
"""

import argparse
import json
import os
import secrets
import threading
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Path as PathParam, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import config
from .catalog import FactId, MonumentId, V20Catalog, load_catalog
from .images import ImageInventory, load_image_inventory
from .rag import InternalRag, RagIntegrityError, RagUnavailableError

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1"})


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)


def _monument_summary(catalog: V20Catalog, images: ImageInventory, mid: str) -> dict:
    m = catalog.monuments[mid]
    return {
        **m.model_dump(exclude={"fact_ids", "draft_ids"}),
        "checkin_eligible": m.checkin_eligible,
        "fact_count": len(m.fact_ids),
        "quarantined_draft_count": len(m.draft_ids),
        "image_count": len(images.for_monument(mid)),
    }


def _fact_view(fact) -> dict:
    return {**fact.model_dump(), "source": {**fact.source.model_dump(), "pdf_page_kind": "physical"}}


def create_internal_app(
    data_dir: Path,
    token: str,
    *,
    rag_encoder=None,
    allowed_client_hosts: frozenset[str] = LOOPBACK_HOSTS,
) -> FastAPI:
    if not isinstance(token, str) or len(token) < config.MIN_TOKEN_LENGTH:
        raise ValueError(f"Dahili erişim anahtarı en az {config.MIN_TOKEN_LENGTH} karakter olmalı.")
    data_dir = Path(data_dir)
    catalog = load_catalog(data_dir)
    images = load_image_inventory(
        data_dir / config.MANIFESTS_DIR / config.IMAGE_MANIFEST_FILE, set(catalog.monuments)
    )
    freeze = json.loads((data_dir / config.V20_DIR / config.FREEZE_MANIFEST_FILE).read_text(encoding="utf-8"))

    app = FastAPI(title="VAKIFNAME Internal", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.catalog = catalog
    app.state.images = images

    rag_lock = threading.Lock()
    rag_state: dict = {}

    def get_rag() -> InternalRag:
        with rag_lock:
            if "rag" not in rag_state and "error" not in rag_state:
                try:
                    rag_state["rag"] = InternalRag(
                        data_dir / config.RAG_RUNTIME_DIR, catalog, freeze["base_database_sha256"], encoder=rag_encoder
                    )
                except (RagUnavailableError, RagIntegrityError, FileNotFoundError) as e:
                    rag_state["error"] = type(e).__name__
        if "error" in rag_state:
            raise HTTPException(status_code=503, detail="Dahili RAG kullanılamıyor.")
        return rag_state["rag"]

    @app.middleware("http")
    async def loopback_only(request: Request, call_next):
        host = request.client.host if request.client else None
        if host not in allowed_client_hosts:
            return JSONResponse(status_code=403, content={"detail": "Dahili API yalnızca yerel erişime açıktır."})
        return await call_next(request)

    def authorize(x_internal_token: Annotated[Optional[str], Header()] = None):
        if not isinstance(x_internal_token, str) or not secrets.compare_digest(
            x_internal_token.encode(), token.encode()
        ):
            raise HTTPException(status_code=401, detail="Yetkisiz dahili istek.")

    router = APIRouter(prefix="/internal", dependencies=[Depends(authorize)])

    def monument_or_404(mid: str):
        if mid not in catalog.monuments:
            raise HTTPException(status_code=404, detail="Eser bulunamadı.")
        return mid

    @router.get("/status")
    def status():
        return {
            "schema_version": catalog.schema_version,
            "access_policy": catalog.access_policy,
            "counts": catalog.verify_freeze_summary(freeze),
            "images": len(images.images),
            "publicly_usable_facts": len(catalog.publicly_usable_facts()),
            "publishable_images": len(images.publishable()),
            "rag_loaded": "rag" in rag_state,
            "rag_index_compatibility": rag_state["rag"].index_compatibility if "rag" in rag_state else None,
            "public_access": False,
        }

    @router.get("/catalog/monuments")
    def list_monuments():
        return [_monument_summary(catalog, images, mid) for mid in catalog.monuments]

    @router.get("/catalog/monuments/{monument_id}")
    def get_monument(monument_id: Annotated[MonumentId, PathParam()]):
        mid = monument_or_404(monument_id)
        return {
            **_monument_summary(catalog, images, mid),
            "facts": [_fact_view(f) for f in catalog.facts_for(mid)],
            "open_issues": [catalog.issues[i].model_dump() for i in catalog.monuments[mid].open_issue_ids
                            if i in catalog.issues],
        }

    @router.get("/catalog/facts/{fact_id}")
    def get_fact(fact_id: Annotated[FactId, PathParam()]):
        fact = catalog.facts.get(fact_id)
        if fact is None:
            raise HTTPException(status_code=404, detail="Olgu bulunamadı.")
        return _fact_view(fact)

    @router.get("/catalog/issues")
    def list_issues():
        return [i.model_dump() for i in catalog.issues.values()]

    @router.get("/catalog/drafts")
    def list_drafts(monument_id: Annotated[Optional[MonumentId], Query()] = None):
        """Karantinadaki aday kayıtlar; yalnızca editoryal inceleme için. RAG ve genel API'de yoktur."""
        drafts = [d for d in catalog.drafts.values() if monument_id is None or d.monument_id == monument_id]
        return {"quarantined": True, "drafts": [d.model_dump() for d in drafts]}

    @router.get("/catalog/images")
    def list_images(monument_id: Annotated[Optional[MonumentId], Query()] = None):
        """Görsel envanteri (yalnızca meta veri). Dosya içeriği bu API'den sunulmaz."""
        records = images.images if monument_id is None else images.for_monument(monument_id)
        return {"files_served": False, "images": [i.model_dump() for i in records]}

    @router.post("/rag/ask")
    def rag_ask(body: AskRequest):
        return get_rag().ask(body.question)

    app.include_router(router)
    return app


def main(argv=None):
    parser = argparse.ArgumentParser(description="VAKIFNAME dahili API (yalnızca loopback)")
    parser.add_argument("--host", default="127.0.0.1", choices=sorted(LOOPBACK_HOSTS))
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)

    token = os.environ.get("VAKIFNAME_INTERNAL_TOKEN", "")
    model_dir = os.environ.get("VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR")
    from .rag import OfflineEncoder

    app = create_internal_app(config.data_dir_from_env(), token, rag_encoder=OfflineEncoder(model_dir))

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, proxy_headers=False, forwarded_allow_ips="")


if __name__ == "__main__":
    main()
