"""İçerik yönetimi uçları (`/admin/content`, yalnızca yönetici). Sözleşme: docs/ICERIK_YONETIMI.md.

Dosyalar ham gövdeyle yüklenir (`POST /admin/content/uploads`, `Content-Type` dosyanın türü); ardından JSON ile kaynak
veya görsel olarak kaydedilir. JSON dışı bir gövde tarayıcıda CORS ön denetimine takılır ve oturum çerezi SameSite=Lax
olduğundan başka siteden gönderilen istek oturum taşımaz.
"""

from typing import Annotated, Literal, Optional

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .content.pipeline import MAX_PAGES
from .content.store import CATEGORIES, CERTAINTY, CITY_NAMES, TYPES, ContentError
from .route_engine import city_slug
from .stats_routes import require_admin

router = APIRouter(prefix="/admin/content", tags=["content"])

MAX_PDF_BYTES = 200 * 1024 * 1024
MAX_IMAGE_BYTES = 25 * 1024 * 1024
UPLOAD_KINDS = {"application/pdf": "pdf", "image/jpeg": "image", "image/png": "image"}
MAGIC = {"application/pdf": b"%PDF-", "image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG\r\n\x1a\n"}

Line = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=1200)]
MonumentId = Annotated[str, Path(pattern=r"^[A-Z]{3}-\d{4}$")]
FactId = Annotated[str, Path(pattern=r"^[A-Z]{3}-\d{4}-F\d{3}$")]
SourceId = Annotated[str, StringConstraints(pattern=r"^SRC-\d{4}$")]


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SourceBody(_Body):
    upload_id: Annotated[str, StringConstraints(pattern=r"^UPL-[0-9a-f]{16}$")]
    title: Line
    rights_confirmed: bool


class MonumentBody(_Body):
    name: Line
    alternative_names: list[Line] = Field(default_factory=list, max_length=10)
    type: Line
    city: Line
    district: Line
    address: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)]
    latitude: Optional[float] = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    site_notice: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)]] = None
    publish: bool = False

    def fields(self) -> dict:
        slug = city_slug(self.city)
        if slug not in CITY_NAMES:
            raise HTTPException(status_code=400, detail="Bilinmeyen şehir.")
        return {"city_slug": slug, "name": self.name, "alternative_names": self.alternative_names, "type": self.type,
                "city": CITY_NAMES[slug], "district": self.district, "address": self.address,
                "latitude": self.latitude, "longitude": self.longitude, "site_notice": self.site_notice or None}


class QuestBody(_Body):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=300)]
    choices: list[Line] = Field(min_length=2, max_length=4)
    answer_index: int = Field(ge=0, le=3)
    explanation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=600)]


class FactFields(_Body):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)]
    text: LongText
    category: Literal[CATEGORIES]  # type: ignore[valid-type]
    certainty: Literal[CERTAINTY]  # type: ignore[valid-type]
    source_id: SourceId
    page: int = Field(ge=1, le=10000)
    quote: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1500)] = ""
    game_use: bool = False
    quest: Optional[QuestBody] = None
    publish: bool = False

    def data(self) -> dict:
        d = self.model_dump(exclude={"publish"})
        return d


class FactCreate(FactFields):
    monument_id: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}-\d{4}$")]


class ExtractBody(_Body):
    source_id: SourceId
    monument_id: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}-\d{4}$")]
    page_from: int = Field(ge=1)
    page_to: int = Field(ge=1)
    # tr: yeni Türkçe kayıt adayları; en: yayındaki Türkçe kayıtların kitabın İngilizce bölümündeki karşılıkları (Faz 11).
    lang: Literal["tr", "en"] = "tr"

    @model_validator(mode="after")
    def _range(self):
        if not 0 <= self.page_to - self.page_from < MAX_PAGES:
            raise ValueError(f"Sayfa aralığı en fazla {MAX_PAGES} sayfa olmalı (başlangıç ≤ bitiş).")
        return self


class ImageBody(_Body):
    upload_id: Annotated[str, StringConstraints(pattern=r"^UPL-[0-9a-f]{16}$")]
    rights_holder: Line
    license: Line
    attribution: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=400)]] = None
    title: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]] = None
    source_url: Optional[Annotated[str, StringConstraints(pattern=r"^https://", max_length=500)]] = None
    publish: bool = False


def _store(request: Request):
    store = getattr(request.app.state, "content", None)
    if store is None:
        raise HTTPException(status_code=503, detail="İçerik deposu kapalı (VAKIFNAME_CONTENT_DIR tanımlı değil).")
    return store


def _admin(request: Request, response: Optional[Response] = None) -> str:
    user = require_admin(request)
    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    return user["email"]


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ContentError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e


@router.get("/overview")
def overview(request: Request, response: Response):
    _admin(request, response)
    vocab = {"certainty": list(CERTAINTY), "category": list(CATEGORIES), "type": list(TYPES),
             "cities": [{"slug": k, "name": v} for k, v in CITY_NAMES.items()]}
    store = getattr(request.app.state, "content", None)
    if store is None:
        return {"enabled": False, "sources": [], "monuments": [], "drafts": 0, "translation_drafts": 0, "vocab": vocab}
    return {"enabled": True, "sources": store.sources(), "monuments": store.monuments(), "drafts": store.draft_count(),
            "translation_drafts": store.translation_draft_count(), "vocab": vocab}


@router.post("/uploads", status_code=201)
async def upload(request: Request, response: Response):
    actor = _admin(request, response)
    store = _store(request)
    ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
    kind = UPLOAD_KINDS.get(ctype)
    if kind is None:
        raise HTTPException(status_code=415, detail="Yalnızca PDF, JPEG veya PNG yüklenebilir.")
    limit = MAX_PDF_BYTES if kind == "pdf" else MAX_IMAGE_BYTES
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail=f"Dosya en fazla {limit // (1024 * 1024)} MB olabilir.")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(status_code=413, detail=f"Dosya en fazla {limit // (1024 * 1024)} MB olabilir.")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data.startswith(MAGIC[ctype]):
        raise HTTPException(status_code=415, detail="Dosya içeriği bildirilen türle uyuşmuyor.")
    return store.save_upload(kind, data, actor)


@router.post("/sources", status_code=201)
def add_source(body: SourceBody, request: Request, response: Response):
    actor = _admin(request, response)
    return _call(_store(request).add_source, body.upload_id, body.title, body.rights_confirmed, actor)


@router.get("/sources/{source_id}/pages/{page}")
def page_text(request: Request, response: Response, source_id: Annotated[str, Path(pattern=r"^SRC-\d{4}$")],
              page: Annotated[int, Path(ge=1)]):
    _admin(request, response)
    return _call(_store(request).page_text, source_id, page)


@router.get("/sources/{source_id}/search")
def search(request: Request, response: Response, source_id: Annotated[str, Path(pattern=r"^SRC-\d{4}$")],
           q: Annotated[str, Query(min_length=2, max_length=100)]):
    _admin(request, response)
    return {"hits": _call(_store(request).search, source_id, q)}


@router.post("/monuments", status_code=201)
def create_monument(body: MonumentBody, request: Request, response: Response):
    actor = _admin(request, response)
    return _call(_store(request).create_monument, body.fields(), body.publish, actor)


@router.get("/monuments/{monument_id}")
def get_monument(request: Request, response: Response, monument_id: MonumentId):
    _admin(request, response)
    store = _store(request)
    return {"monument": _call(store.monument, monument_id), "facts": store.facts(monument_id=monument_id),
            "images": store.images(monument_id), "translations": store.translations(monument_id=monument_id),
            "monument_en": store.monument_en(monument_id), "tr_facts": store.published_tr_facts(monument_id)}


@router.put("/monuments/{monument_id}")
def update_monument(body: MonumentBody, request: Request, response: Response, monument_id: MonumentId):
    actor = _admin(request, response)
    return _call(_store(request).update_monument, monument_id, body.fields(), body.publish, actor)


@router.post("/monuments/{monument_id}/withdraw")
def withdraw_monument(request: Request, response: Response, monument_id: MonumentId):
    actor = _admin(request, response)
    return _call(_store(request).withdraw_monument, monument_id, actor)


@router.get("/facts")
def list_facts(request: Request, response: Response,
               status: Annotated[Optional[Literal["draft", "published", "rejected", "withdrawn"]], Query()] = None,
               monument_id: Annotated[Optional[str], Query(pattern=r"^[A-Z]{3}-\d{4}$")] = None):
    _admin(request, response)
    return {"facts": _store(request).facts(status, monument_id)}


@router.post("/facts", status_code=201)
def create_fact(body: FactCreate, request: Request, response: Response):
    actor = _admin(request, response)
    data = body.model_dump(exclude={"publish", "monument_id"})
    return _call(_store(request).create_fact, body.monument_id, data, "manual", body.publish, actor)


@router.put("/facts/{fact_id}")
def update_fact(body: FactFields, request: Request, response: Response, fact_id: FactId):
    actor = _admin(request, response)
    return _call(_store(request).update_fact, fact_id, body.data(), body.publish, actor)


@router.post("/facts/{fact_id}/{action}")
def fact_action(request: Request, response: Response, fact_id: FactId,
                action: Annotated[Literal["publish", "reject", "withdraw"], Path()]):
    actor = _admin(request, response)
    return _call(_store(request).set_fact_status, fact_id, action, actor)


@router.post("/extract", status_code=202)
def extract(body: ExtractBody, request: Request, response: Response):
    actor = _admin(request, response)
    store = _store(request)
    pipeline = request.app.state.content_pipeline
    src = _call(store.source, body.source_id)
    if body.page_to > src["page_count"]:
        raise HTTPException(status_code=400, detail=f"Sayfa 1–{src['page_count']} aralığında olmalı.")
    _call(store.monument, body.monument_id)
    ok, why = pipeline.available()
    if not ok:
        raise HTTPException(status_code=503, detail=why)
    if store.active_job() is not None:
        raise HTTPException(status_code=409, detail="Süren bir aday çıkarma işi var; bitmesini bekleyin.")
    return pipeline.submit(body.source_id, body.monument_id, body.page_from, body.page_to, actor, body.lang)


@router.get("/jobs/{job_id}")
def get_job(request: Request, response: Response, job_id: Annotated[str, Path(pattern=r"^JOB-[0-9a-f]{12}$")]):
    _admin(request, response)
    return _call(_store(request).job, job_id)


@router.post("/monuments/{monument_id}/images", status_code=201)
def add_image(body: ImageBody, request: Request, response: Response, monument_id: MonumentId):
    actor = _admin(request, response)
    meta = body.model_dump(exclude={"upload_id", "publish"})
    return _call(_store(request).add_image, monument_id, body.upload_id, meta, body.publish, actor)


@router.post("/images/{image_id}/{action}")
def image_action(request: Request, response: Response,
                 image_id: Annotated[str, Path(pattern=r"^[A-Z]{3}-\d{4}-G\d{3}$")],
                 action: Annotated[Literal["publish", "withdraw"], Path()]):
    actor = _admin(request, response)
    return _call(_store(request).set_image_status, image_id, action, actor)


class QuestEnBody(_Body):
    """Sorunun İngilizcesi: şıklar Türkçe soruyla aynı sırada; doğru cevap gönderilmez (Türkçe sorudaki kalır)."""
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=300)]
    choices: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]] = Field(
        min_length=2, max_length=4)
    explanation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=600)]


class TranslationBody(_Body):
    title_en: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)]
    text_en: LongText
    quote_en: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1500)] = ""
    source_id: SourceId
    page: int = Field(ge=1, le=10000)
    quest_en: Optional[QuestEnBody] = None
    note: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=1200)]] = None
    publish: bool = False


class MonumentEnBody(_Body):
    name_en: Line
    site_notice_en: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)]] = None
    alternative_names_en: list[Line] = Field(default_factory=list, max_length=10)
    address_en: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]] = None
    publish: bool = False


@router.get("/translations")
def list_translations(request: Request, response: Response,
                      status: Annotated[Optional[Literal["draft", "published", "rejected", "withdrawn"]], Query()] = None,
                      monument_id: Annotated[Optional[str], Query(pattern=r"^[A-Z]{3}-\d{4}$")] = None):
    _admin(request, response)
    return {"translations": _store(request).translations(status, monument_id)}


@router.put("/facts/{fact_id}/en")
def put_translation(body: TranslationBody, request: Request, response: Response, fact_id: FactId):
    actor = _admin(request, response)
    return _call(_store(request).set_translation, fact_id, body.model_dump(exclude={"publish"}), body.publish, actor)


@router.post("/facts/{fact_id}/en/{action}")
def translation_action(request: Request, response: Response, fact_id: FactId,
                       action: Annotated[Literal["publish", "reject", "withdraw"], Path()]):
    actor = _admin(request, response)
    return _call(_store(request).translation_action, fact_id, action, actor)


@router.put("/monuments/{monument_id}/en")
def put_monument_en(body: MonumentEnBody, request: Request, response: Response, monument_id: MonumentId):
    actor = _admin(request, response)
    data = {"name_en": body.name_en, "site_notice_en": body.site_notice_en or None,
            "alternative_names_en": body.alternative_names_en, "address_en": body.address_en or None}
    return _call(_store(request).set_monument_en, monument_id, data, body.publish, actor)


class SourceImageBody(_Body):
    source_id: SourceId
    page: int = Field(ge=1, le=10000)
    index: int = Field(ge=0, le=200)
    title: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]] = None
    publish: bool = False


@router.get("/sources/{source_id}/pages/{page}/images")
def page_images(request: Request, response: Response, source_id: Annotated[str, Path(pattern=r"^SRC-\d{4}$")],
                page: Annotated[int, Path(ge=1)]):
    _admin(request, response)
    return {"images": _call(_store(request).page_images, source_id, page)}


@router.get("/sources/{source_id}/pages/{page}/images/{index}")
def page_image(request: Request, source_id: Annotated[str, Path(pattern=r"^SRC-\d{4}$")],
               page: Annotated[int, Path(ge=1)], index: Annotated[int, Path(ge=0, le=200)]):
    _admin(request)
    data = _call(_store(request).page_image_preview, source_id, page, index)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.post("/monuments/{monument_id}/images/from-source", status_code=201)
def add_image_from_source(body: SourceImageBody, request: Request, response: Response, monument_id: MonumentId):
    actor = _admin(request, response)
    return _call(_store(request).add_image_from_source, monument_id, body.source_id, body.page, body.index, body.title,
                 body.publish, actor)


@router.get("/media/{file}")
def media(request: Request, file: Annotated[str, Path(pattern=r"^[0-9a-f]{64}\.jpg$")]):
    _admin(request)
    path = _store(request).media_file(file)
    if path is None:
        raise HTTPException(status_code=404, detail="Görsel bulunamadı.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})
