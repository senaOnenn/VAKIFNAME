"""Yetkili dahili katalog ve RAG test API'si.

Genel API'den (`app.main`) tamamen ayrı bir uygulamadır; genel uygulamaya hiçbir rota eklemez.
- Yalnızca loopback istemcilerini kabul eder (aksi halde 403).
- Her istek yetki ister (aksi halde 401). Anahtar yalnızca sunucu tarafında, `VAKIFNAME_INTERNAL_TOKEN`
  ortam değişkeninde tutulur; frontend'e konmaz. İki yol vardır:
  * Komut satırı / betik: `X-Internal-Token` başlığı.
  * Tarayıcıdaki inceleme ekranı: anahtar bir kez `POST /internal/session` ile girilir; sunucu kısa ömürlü,
    `HttpOnly` + `SameSite=Strict` bir oturum çerezi verir. Çerezli her istek ayrıca `X-Vakifname-Review: 1`
    başlığı taşımalıdır (CORS olmadığından başka bir origin bu başlığı gönderemez; CSRF koruması).
- Yanıtlar `Cache-Control: no-store` ile döner; tarayıcı önbelleğinde kalmaz.
- CORS middleware'i yoktur: tarayıcıdaki başka origin'ler bu API'yi çağıramaz.
- OpenAPI/dokümantasyon sayfaları kapalıdır.
- Görsel veya PDF dosyası sunmaz; yalnızca meta veri döner.

Editör kararları (`/internal/review/...`):
- Paylaşılan anahtar bir kişinin kimliğini kanıtlamaz. Karar kaydetmek için oturum ayrıca **kişisel incelemeci hesabıyla**
  (`POST /internal/session/reviewer`) bağlanmalıdır. Hesaplar yalnızca sunucuda komut satırından oluşturulur
  (`python -m app.internal.reviewers`). `X-Internal-Token` ile karar kaydedilemez.
- Her karar tek bir kayıt içindir ve önceden açılmış inceleme biletiyle gönderilir (bkz. `decisions.py`).

Çalıştırma (yalnızca 127.0.0.1; anahtar dosyadan okunur, süreç ortamına konmaz):

    VAKIFNAME_INTERNAL_TOKEN_FILE=/var/lib/vakifname-internal/secrets/internal_token python -m app.internal.server --port 8765

Eski yöntem `VAKIFNAME_INTERNAL_TOKEN=...` hâlâ desteklenir; anahtar rotasyonu için `scripts/rotate_internal_token.py`.
"""

import argparse
import json
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Cookie, Depends, FastAPI, Header, HTTPException, Path as PathParam, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from . import config
from .batch import BatchReview, load_proposals
from .catalog import FactId, MonumentId, SourceAuditRecord, V20Catalog, load_catalog, load_source_audit
from .decisions import (
    DEFAULT_MIN_REVIEW_SECONDS, DEFAULT_RATE_LIMIT, DECISION_TYPES_BY_KIND, SPECS, DecisionError, DecisionService,
    data_version_for,
)
from .corroboration import load_corroboration
from .catalog import sha256_file as _sha256_file
from .images import ImageInventory, load_holdout, load_image_inventory
from .location_review import FLAG_LABELS, candidate_rows
from .publish import build_snapshot, write_snapshot
from .rag import InternalRag, RagIntegrityError, RagUnavailableError
from .research import load_research
from .review import review_status
from .review_store import ReviewStore, utc_now

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1"})
SESSION_COOKIE = "vakifname_review_session"
REVIEW_CLIENT_HEADER = "1"
DEFAULT_SESSION_TTL_S = 2 * 60 * 60
MAX_SESSIONS = 16
# Hatalı anahtar denemeleri: pencere içinde bu sayıya ulaşılınca giriş geçici olarak kapanır.
MAX_FAILED_LOGINS = 5
FAILED_LOGIN_WINDOW_S = 60


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)


class SessionRequest(BaseModel):
    token: str = Field(min_length=1, max_length=512)


class ReviewerLoginRequest(BaseModel):
    reviewer_id: str = Field(min_length=1, max_length=64)
    credential: str = Field(min_length=1, max_length=512)


class TicketRequest(BaseModel):
    model_config = {"extra": "forbid"}
    # Tek konu: liste veya toplu kimlik kabul edilmez.
    subject_kind: str = Field(min_length=1, max_length=16)
    subject_id: str = Field(min_length=1, max_length=128)
    decision_type: str = Field(min_length=1, max_length=32)


class BatchTicketRequest(BaseModel):
    model_config = {"extra": "forbid"}
    keys: list[str] = Field(min_length=1, max_length=200)


class BatchItem(BaseModel):
    model_config = {"extra": "forbid"}
    key: str = Field(min_length=1, max_length=200)
    decision: Literal["approved", "rejected", "needs_revision"]
    source_check: Optional[str] = Field(default=None, max_length=32)
    note: Optional[str] = Field(default=None, max_length=1000)
    payload: dict = Field(default_factory=dict)


class BatchDecisionRequest(BaseModel):
    model_config = {"extra": "forbid"}
    ticket_id: str = Field(min_length=1, max_length=64)
    rationale: str = Field(min_length=1, max_length=4000)
    items: list[BatchItem] = Field(min_length=1, max_length=200)


class DecisionRequest(BaseModel):
    model_config = {"extra": "forbid"}
    ticket_id: str = Field(min_length=1, max_length=64)
    decision: Literal["approved", "rejected", "needs_revision"]
    source_check: str = Field(min_length=1, max_length=32)
    rationale: str = Field(min_length=1, max_length=4000)
    payload: dict = Field(default_factory=dict)


class SessionStore:
    """Bellek içi inceleme oturumları. Sunucu yeniden başlatılınca tüm oturumlar düşer."""

    def __init__(self, ttl_s: float, clock=time.monotonic):
        self.ttl_s = ttl_s
        self._clock = clock
        self._sessions: dict[str, float] = {}
        # Oturuma bağlanmış kişisel incelemeci hesabı (yoksa oturum yalnızca okuma yapabilir).
        self._reviewers: dict[str, str] = {}
        self._failures: list[float] = []
        self._lock = threading.Lock()

    def _prune(self, now: float):
        self._sessions = {sid: exp for sid, exp in self._sessions.items() if exp > now}
        self._reviewers = {sid: rid for sid, rid in self._reviewers.items() if sid in self._sessions}
        self._failures = [t for t in self._failures if now - t < FAILED_LOGIN_WINDOW_S]

    def locked_out(self) -> bool:
        with self._lock:
            self._prune(self._clock())
            return len(self._failures) >= MAX_FAILED_LOGINS

    def record_failure(self):
        with self._lock:
            self._failures.append(self._clock())

    def create(self) -> str:
        with self._lock:
            now = self._clock()
            self._prune(now)
            if len(self._sessions) >= MAX_SESSIONS:
                # En eski oturum düşürülür; bellek sınırsız büyümez.
                del self._sessions[min(self._sessions, key=self._sessions.get)]
            sid = secrets.token_urlsafe(32)
            self._sessions[sid] = now + self.ttl_s
            return sid

    def valid(self, sid: str) -> bool:
        with self._lock:
            exp = self._sessions.get(sid)
            return exp is not None and exp > self._clock()

    def revoke(self, sid: Optional[str]):
        with self._lock:
            self._sessions.pop(sid, None)
            self._reviewers.pop(sid, None)

    def attach_reviewer(self, sid: str, reviewer_id: str):
        with self._lock:
            self._reviewers[sid] = reviewer_id

    def detach_reviewer(self, sid: Optional[str]):
        with self._lock:
            self._reviewers.pop(sid, None)

    def reviewer_of(self, sid: Optional[str]) -> Optional[str]:
        with self._lock:
            return self._reviewers.get(sid) if sid is not None else None


def _monument_summary(service: DecisionService, mid: str, latest: dict) -> dict:
    catalog, images = service.catalog, service.images
    m = catalog.monuments[mid]
    review = review_status(catalog, images, service.audit, mid, service, latest)
    return {
        **m.model_dump(exclude={"fact_ids", "draft_ids", "location"}),
        "location": service.effective_location(mid, latest).model_dump(mode="json"),
        # Harita ve check-in ayrı kararlardır; doğrulanmış konum tek başına ikisini de açmaz.
        "checkin_eligible": review.gates["gps_checkin"],
        "map_eligible": review.gates["map_display"],
        "fact_count": len(m.fact_ids),
        "quarantined_draft_count": len(m.draft_ids),
        "image_count": len(images.for_monument(mid)),
        "review": review.model_dump(),
    }


def build_review_context(
    data_dir: Path,
    research_file: Optional[Path] = None,
    review_db: Optional[Path] = None,
    *,
    min_review_seconds: float = DEFAULT_MIN_REVIEW_SECONDS,
    rate_limit: tuple[int, int] = DEFAULT_RATE_LIMIT,
    monotonic=time.monotonic,
    wall_clock=utc_now,
    corroboration_file: Optional[Path] = None,
    commons_file: Optional[Path] = None,
    candidates_file: Optional[Path] = None,
    zip_overlay_file: Optional[Path] = None,
) -> DecisionService:
    """V20 kataloğunu, görselleri, sayfa denetimini, araştırmayı ve inceleme veritabanını bir arada yükler."""
    data_dir = Path(data_dir)
    catalog = load_catalog(data_dir)
    holdout = load_holdout(data_dir / config.HOLDOUT_TEST_SET_FILE)
    images = load_image_inventory(
        data_dir / config.MANIFESTS_DIR / config.IMAGE_MANIFEST_FILE, set(catalog.monuments), commons_file,
        candidates_file=candidates_file, holdout=holdout, zip_overlay_file=zip_overlay_file,
    )
    audit = load_source_audit(data_dir / config.MANIFESTS_DIR / config.SOURCE_PAGE_AUDIT_FILE, catalog)
    freeze = json.loads((data_dir / config.V20_DIR / config.FREEZE_MANIFEST_FILE).read_text(encoding="utf-8"))
    store = ReviewStore(review_db or data_dir / config.REVIEW_DB_FILE, clock=wall_clock)
    return DecisionService(
        catalog=catalog, images=images, audit=audit, research=load_research(research_file, catalog), store=store,
        data_version=data_version_for(freeze), min_review_seconds=min_review_seconds, rate_limit=rate_limit,
        monotonic=monotonic, corroboration=load_corroboration(corroboration_file, catalog), holdout=holdout,
    )


def _audit_result(audit: dict[str, SourceAuditRecord], record_id: str) -> str:
    return audit[record_id].result if record_id in audit else "not_audited"


def _fact_view(catalog: V20Catalog, audit: dict, fact) -> dict:
    return {
        **fact.model_dump(),
        "publicly_usable": fact.access.publicly_usable,
        "source": {
            **fact.source.model_dump(),
            "pdf_page_kind": "physical",
            "pdf_physical_page_count": catalog.sources[fact.source.source_file].physical_page_count,
            "page_audit": _audit_result(audit, fact.fact_id),
        },
    }


def create_internal_app(
    data_dir: Path,
    token: str,
    *,
    rag_encoder=None,
    allowed_client_hosts: frozenset[str] = LOOPBACK_HOSTS,
    session_ttl_s: float = DEFAULT_SESSION_TTL_S,
    clock=time.monotonic,
    research_file: Optional[Path] = None,
    review_db: Optional[Path] = None,
    min_review_seconds: float = DEFAULT_MIN_REVIEW_SECONDS,
    rate_limit: tuple[int, int] = DEFAULT_RATE_LIMIT,
    wall_clock=utc_now,
    corroboration_file: Optional[Path] = None,
    commons_file: Optional[Path] = None,
    candidates_file: Optional[Path] = None,
    zip_overlay_file: Optional[Path] = None,
    proposals_file: Optional[Path] = None,
    publish_out: Optional[Path] = None,
) -> FastAPI:
    if not isinstance(token, str) or len(token) < config.MIN_TOKEN_LENGTH:
        raise ValueError(f"Dahili erişim anahtarı en az {config.MIN_TOKEN_LENGTH} karakter olmalı.")
    data_dir = Path(data_dir)
    service = build_review_context(
        data_dir, research_file, review_db, min_review_seconds=min_review_seconds, rate_limit=rate_limit,
        monotonic=clock, wall_clock=wall_clock, corroboration_file=corroboration_file, commons_file=commons_file,
        candidates_file=candidates_file, zip_overlay_file=zip_overlay_file,
    )
    batch = BatchReview(service, load_proposals(proposals_file))
    publish_lock = threading.Lock()

    def publish_snapshot(actor: str) -> dict:
        """Genel katalog anlık görüntüsünü yeniden yazar (yalnızca geçerli yayın onayları). Yapılandırılmamışsa atlanır."""
        if publish_out is None:
            return {"published": False, "reason": "Genel katalog çıktısı yapılandırılmadı (VAKIFNAME_PUBLIC_CATALOG_OUT)."}
        with publish_lock:
            try:
                snap = write_snapshot(service, publish_out, data_dir / config.IMAGES_DIR, actor,
                                      commons_dir=data_dir / config.COMMONS_IMAGES_DIR)
            except (OSError, ValueError) as e:
                return {"published": False, "reason": f"Yayın dosyası yazılamadı: {e}"}
        return {"published": True, "monuments": len(snap.monuments), "facts": sum(len(m.facts) for m in snap.monuments),
                "images": sum(len(m.images) for m in snap.monuments)}
    catalog, images, audit, store = service.catalog, service.images, service.audit, service.store
    freeze = json.loads((data_dir / config.V20_DIR / config.FREEZE_MANIFEST_FILE).read_text(encoding="utf-8"))
    sessions = SessionStore(session_ttl_s, clock)

    app = FastAPI(title="VAKIFNAME Internal", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.catalog = catalog
    app.state.images = images
    app.state.review = service

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
            response = JSONResponse(status_code=403, content={"detail": "Dahili API yalnızca yerel erişime açıktır."})
        else:
            response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    def token_matches(candidate: str) -> bool:
        return secrets.compare_digest(candidate.encode(), token.encode())

    def require_review_client(x_vakifname_review: Annotated[Optional[str], Header()] = None):
        if x_vakifname_review != REVIEW_CLIENT_HEADER:
            raise HTTPException(status_code=401, detail="Yetkisiz dahili istek.")

    def authorize(
        x_internal_token: Annotated[Optional[str], Header()] = None,
        x_vakifname_review: Annotated[Optional[str], Header()] = None,
        session: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE)] = None,
    ):
        if x_internal_token is not None:
            if token_matches(x_internal_token):
                return None
        elif session is not None and sessions.valid(session) and x_vakifname_review == REVIEW_CLIENT_HEADER:
            return session
        raise HTTPException(status_code=401, detail="Yetkisiz dahili istek.")

    def require_reviewer(session: Annotated[Optional[str], Depends(authorize)]):
        """Karar kaydı için kişisel incelemeci hesabı bağlı tarayıcı oturumu gerekir."""
        reviewer_id = sessions.reviewer_of(session)
        reviewer = store.reviewer(reviewer_id) if reviewer_id else None
        if reviewer is None or not reviewer.active:
            raise HTTPException(
                status_code=403,
                detail="Karar kaydı için kişisel incelemeci hesabıyla giriş gerekir; paylaşılan anahtar kimlik kanıtlamaz.",
            )
        return session, reviewer

    # Oturum açma uçları anahtarın kendisini veya oturumu kontrol eder; genel yetki bağımlılığı uygulanmaz.
    session_router = APIRouter(prefix="/internal/session", dependencies=[Depends(require_review_client)])

    @session_router.post("", status_code=204)
    def open_session(body: SessionRequest, response: Response):
        if sessions.locked_out():
            raise HTTPException(status_code=429, detail="Çok fazla hatalı deneme. Bir dakika sonra tekrar deneyin.")
        if not token_matches(body.token):
            sessions.record_failure()
            raise HTTPException(status_code=401, detail="Erişim anahtarı geçersiz.")
        response.set_cookie(
            SESSION_COOKIE,
            sessions.create(),
            max_age=int(sessions.ttl_s),
            path="/internal",
            httponly=True,
            samesite="strict",
            # Sunucu yalnızca loopback HTTP üzerinde çalışır; Secure bayrağı bazı tarayıcılarda çerezi engeller.
            secure=False,
        )

    @session_router.get("")
    def session_status(session: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE)] = None):
        if session is None or not sessions.valid(session):
            raise HTTPException(status_code=401, detail="Oturum yok veya süresi doldu.")
        reviewer_id = sessions.reviewer_of(session)
        reviewer = store.reviewer(reviewer_id) if reviewer_id else None
        return {
            "authenticated": True,
            "session_ttl_s": sessions.ttl_s,
            "reviewer": ({"reviewer_id": reviewer.reviewer_id, "display_name": reviewer.display_name,
                          "roles": list(reviewer.roles)} if reviewer and reviewer.active else None),
        }

    @session_router.post("/reviewer", status_code=204)
    def reviewer_login(body: ReviewerLoginRequest,
                       session: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE)] = None):
        if session is None or not sessions.valid(session):
            raise HTTPException(status_code=401, detail="Önce dahili oturum açın.")
        if sessions.locked_out():
            raise HTTPException(status_code=429, detail="Çok fazla hatalı deneme. Bir dakika sonra tekrar deneyin.")
        reviewer = store.authenticate(body.reviewer_id, body.credential)
        if reviewer is None:
            sessions.record_failure()
            store.log("anonymous", "reviewer_login_failed", f"reviewer:{body.reviewer_id[:64]}")
            raise HTTPException(status_code=401, detail="İncelemeci kimliği veya kimlik bilgisi geçersiz.")
        sessions.attach_reviewer(session, reviewer.reviewer_id)
        store.log(reviewer.reviewer_id, "reviewer_login", f"reviewer:{reviewer.reviewer_id}")

    @session_router.delete("/reviewer", status_code=204)
    def reviewer_logout(session: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE)] = None):
        reviewer_id = sessions.reviewer_of(session)
        sessions.detach_reviewer(session)
        if reviewer_id:
            store.log(reviewer_id, "reviewer_logout", f"reviewer:{reviewer_id}")

    @session_router.delete("", status_code=204)
    def close_session(response: Response, session: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE)] = None):
        reviewer_id = sessions.reviewer_of(session)
        sessions.revoke(session)
        if reviewer_id:
            store.log(reviewer_id, "reviewer_logout", f"reviewer:{reviewer_id}")
        response.delete_cookie(SESSION_COOKIE, path="/internal", httponly=True, samesite="strict")

    router = APIRouter(prefix="/internal", dependencies=[Depends(authorize)])

    def monument_or_404(mid: str):
        if mid not in catalog.monuments:
            raise HTTPException(status_code=404, detail="Eser bulunamadı.")
        return mid

    @router.get("/status")
    def status():
        latest = store.latest_all()
        return {
            "schema_version": catalog.schema_version,
            "access_policy": catalog.access_policy,
            "counts": catalog.verify_freeze_summary(freeze),
            "images": len(images.images),
            "locations": {
                status: sum(service.effective_location(mid, latest).status == status for mid in catalog.monuments)
                for status in ("missing", "unverified", "verified")
            },
            "source_audit_loaded": bool(audit),
            "publicly_usable_facts": len(catalog.publicly_usable_facts()),
            "publishable_images": len(images.publishable()),
            "rag_loaded": "rag" in rag_state,
            "rag_index_compatibility": rag_state["rag"].index_compatibility if "rag" in rag_state else None,
            "public_access": False,
        }

    @router.get("/catalog/monuments")
    def list_monuments():
        latest = store.latest_all()
        return [_monument_summary(service, mid, latest) for mid in catalog.monuments]

    @router.get("/catalog/monuments/{monument_id}")
    def get_monument(monument_id: Annotated[MonumentId, PathParam()]):
        mid = monument_or_404(monument_id)
        latest = store.latest_all()
        return {
            **_monument_summary(service, mid, latest),
            "facts": [_fact_view(catalog, audit, f) for f in catalog.facts_for(mid)],
            "open_issues": [catalog.issues[i].model_dump() for i in catalog.monuments[mid].open_issue_ids
                            if i in catalog.issues],
        }

    @router.get("/catalog/facts/{fact_id}")
    def get_fact(fact_id: Annotated[FactId, PathParam()]):
        fact = catalog.facts.get(fact_id)
        if fact is None:
            raise HTTPException(status_code=404, detail="Olgu bulunamadı.")
        return _fact_view(catalog, audit, fact)

    @router.get("/catalog/issues")
    def list_issues():
        return [i.model_dump() for i in catalog.issues.values()]

    @router.get("/catalog/drafts")
    def list_drafts(monument_id: Annotated[Optional[MonumentId], Query()] = None):
        """Karantinadaki aday kayıtlar; yalnızca editoryal inceleme için. RAG ve genel API'de yoktur."""
        drafts = [d for d in catalog.drafts.values() if monument_id is None or d.monument_id == monument_id]
        return {
            "quarantined": True,
            "drafts": [{**d.model_dump(), "page_audit": _audit_result(audit, d.draft_id)} for d in drafts],
        }

    @router.get("/catalog/images")
    def list_images(monument_id: Annotated[Optional[MonumentId], Query()] = None):
        """Görsel envanteri (yalnızca meta veri). Dosya içeriği bu API'den sunulmaz."""
        records = images.images if monument_id is None else images.for_monument(monument_id)
        return {"files_served": False, "images": [i.model_dump() for i in records]}

    @router.get("/catalog/research/{monument_id}")
    def get_research(monument_id: Annotated[MonumentId, PathParam()]):
        """Kaynak doğrulaması, adres iddiaları, tutarsızlıklar ve koordinat adayları (hepsi doğrulanmamış)."""
        mid = monument_or_404(monument_id)
        r = service.research.get(mid)
        latest = store.latest_all()
        return {
            "monument_id": mid,
            "research": r.model_dump(mode="json") if r else None,
            "method": service.research.method,
            "attribution": service.research.attribution,
            "effective_location": service.effective_location(mid, latest).model_dump(mode="json"),
        }

    # --- Editör inceleme iş akışı ---------------------------------------------------

    def decision_error(e: DecisionError):
        return HTTPException(status_code=e.status, detail={"code": e.code, "message": str(e)})

    @router.get("/review/overview")
    def review_overview():
        latest = store.latest_all()
        counts: dict[str, dict[str, int]] = {}
        for kind, types in DECISION_TYPES_BY_KIND.items():
            ids = _subject_ids(kind)
            for dt in types:
                c = counts.setdefault(dt, {"pending": 0, "approved": 0, "rejected": 0, "needs_revision": 0, "stale": 0})
                for sid in ids:
                    eff = service.effective(kind, sid, dt, latest)
                    c[eff.status] += 1
                    c["stale"] += eff.stale
        return {
            "data_version": service.data_version,
            "decision_types": {k: {"label": v.label, "role": v.role, "subject_kind": v.subject_kind}
                               for k, v in SPECS.items()},
            "counts": counts,
            "subjects": {"facts": len(catalog.facts), "drafts_quarantined": len(catalog.drafts),
                         "issues": len(catalog.issues), "images": len(images.images), "sources": len(catalog.sources)},
            "issues": [{**i.model_dump(mode="json"),
                        "resolution": service.effective("issue", i.issue_id, "issue_resolution", latest).to_dict()}
                       for i in catalog.issues.values()],
            "reviewers": len([r for r in store.reviewers() if r.active]),
            "identity_policy": (
                "Paylaşılan dahili anahtar yalnızca okuma erişimi verir ve bir kişinin kimliğini kanıtlamaz. "
                "Kararlar yalnızca kişisel incelemeci hesabıyla ve rol yetkisiyle kaydedilir."
            ),
            "rag_public_release": {
                "status": "blocked",
                "reasons": ["faiss_embedding_index_mismatch", "irrelevant_results_without_evidence",
                            "separate_quality_and_approval_stage_required"],
            },
        }

    def _subject_ids(kind: str) -> list[str]:
        return {
            "monument": list(catalog.monuments), "location": list(catalog.monuments), "fact": list(catalog.facts),
            "draft": list(catalog.drafts), "issue": list(catalog.issues), "source": list(catalog.sources),
            "image": [i.image_id for i in images.images],
        }[kind]

    @router.get("/review/subjects/{subject_kind}/{subject_id:path}")
    def review_subject(subject_kind: str, subject_id: str):
        if subject_kind not in DECISION_TYPES_BY_KIND:
            raise HTTPException(status_code=404, detail="Bilinmeyen kayıt türü.")
        try:
            content = service.subject(subject_kind, subject_id)
        except DecisionError as e:
            raise decision_error(e) from None
        return {
            "subject_kind": subject_kind,
            "subject_id": subject_id,
            "content": content,
            "subject_sha256": service.subject_sha256(subject_kind, subject_id),
            "decisions": service.decisions_for(subject_kind, subject_id),
            "history": [d.to_dict() for d in store.history(subject_kind, subject_id)],
        }

    @router.post("/review/tickets")
    def open_ticket(body: TicketRequest, ctx: Annotated[tuple, Depends(require_reviewer)]):
        session, reviewer = ctx
        try:
            return service.open_ticket(session, reviewer, body.subject_kind, body.subject_id, body.decision_type)
        except DecisionError as e:
            raise decision_error(e) from None

    @router.post("/review/decisions", status_code=201)
    def record_decision(body: DecisionRequest, ctx: Annotated[tuple, Depends(require_reviewer)]):
        session, reviewer = ctx
        try:
            rec = service.submit(session, reviewer, ticket_id=body.ticket_id, decision=body.decision,
                                 source_check=body.source_check, rationale=body.rationale, payload=body.payload)
        except DecisionError as e:
            raise decision_error(e) from None
        return rec.to_dict()

    @router.get("/review/batch")
    def batch_listing(session: Annotated[Optional[str], Depends(authorize)]):
        """Toplu inceleme listesi: önerili kayıtlar, kanıtları, ön koşulları ve incelemecinin rolüne göre izinleri."""
        reviewer_id = sessions.reviewer_of(session)
        reviewer = store.reviewer(reviewer_id) if reviewer_id else None
        return batch.listing(reviewer if reviewer and reviewer.active else None)

    @router.post("/review/batch/tickets")
    def batch_ticket(body: BatchTicketRequest, ctx: Annotated[tuple, Depends(require_reviewer)]):
        session, reviewer = ctx
        try:
            return batch.open_ticket(session, reviewer, body.keys)
        except DecisionError as e:
            raise decision_error(e) from None

    @router.post("/review/batch/decisions")
    def batch_decisions(body: BatchDecisionRequest, ctx: Annotated[tuple, Depends(require_reviewer)]):
        session, reviewer = ctx
        try:
            result = batch.submit(session, reviewer, ticket_id=body.ticket_id, rationale=body.rationale,
                                  items=[i.model_dump() for i in body.items])
        except DecisionError as e:
            raise decision_error(e) from None
        # Onaylar tamamlanan eserler genel katalogda kendiliğinden yerini alır.
        result["publication"] = publish_snapshot(f"reviewer:{reviewer.reviewer_id}") if result["recorded"] else None
        return result

    @router.post("/review/publish")
    def publish_now(ctx: Annotated[tuple, Depends(require_reviewer)]):
        """Yayın anlık görüntüsünü elle yeniler (yalnızca kişisel incelemeci hesabıyla)."""
        _, reviewer = ctx
        return publish_snapshot(f"reviewer:{reviewer.reviewer_id}")

    def media_ref(img, variant: str):
        """(dosya, beklenen özet) — Commons saklanan dosyası veya ZIP fotoğrafının sRGB görüntüleme kopyası."""
        if img.collection == "wikimedia_commons":
            ref = img.card if variant == "card" and img.card is not None else img
            return data_dir / config.COMMONS_IMAGES_DIR / ref.relative_path, ref.sha256
        if img.display:
            ref = img.display.get(variant) or img.display["detail"]
            return data_dir / config.HACKATHON_ZIP_DISPLAY_DIR / ref.relative_path, ref.sha256
        return None

    @router.get("/review/media/{variant}/{image_id:path}")
    def review_media(variant: Literal["card", "detail"], image_id: str):
        """İnceleme önizlemesi: envanterdeki fotoğrafın saklanan dosyası, SHA-256 doğrulanarak.

        Commons fotoğrafları ve hackathon ZIP fotoğraflarının görüntüleme kopyaları. Yalnızca loopback ve yetkili istemci;
        yol istemciden alınmaz, manifest kaydından gelir. Genel yayın değildir.
        """
        img = next((i for i in images.images if i.image_id == image_id), None)
        ref = media_ref(img, variant) if img is not None else None
        if ref is None:
            raise HTTPException(status_code=404, detail="Görsel bulunamadı.")
        path, digest = ref
        if not path.is_file() or _sha256_file(path) != digest:
            raise HTTPException(status_code=409, detail="Görsel dosyası manifestteki SHA-256 ile uyuşmuyor.")
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @router.get("/review/gallery/{monument_id}")
    def review_gallery(monument_id: Annotated[MonumentId, PathParam()]):
        """Dahili galeri önizlemesi (yalnızca yetkili). Hiçbir şeyi yayımlamaz veya onaylamaz.

        Bölümler: yayında olanlar; Commons adayları; ZIP fotoğraflarından belgelenmiş çelişkisi olmayanlar (galeri
        adayı); belgelenmiş çelişkisi olduğu için incelemeye ayrılanlar; başka klasörde olup kitapla bu esere ait olduğu
        doğrulananlar (yalnızca öneri).
        """
        mid = monument_or_404(monument_id)
        latest = store.latest_all()
        name = catalog.monuments[mid].name

        def item(img) -> dict:
            p = img.provenance or {}
            z = img.zip_import or {}
            size = img.display["detail"] if img.display else img
            return {
                "image_id": img.image_id, "folder_monument_id": img.monument_id,
                "card_url": f"/internal/review/media/card/{img.image_id}",
                "detail_url": f"/internal/review/media/detail/{img.image_id}",
                "width": size.width, "height": size.height,
                "caption": (z.get("identity") or {}).get("summary") or (p.get("verification") or {}).get("notes"),
                "source": ("Hackathon veri paketi (ZIP) · " + z["entry"]["folder"].strip() + "/" + z["entry"]["file"]) if z
                          else f"Wikimedia Commons · {p.get('artist') or '—'} · {p.get('license_short_name') or '—'}",
                "source_url": None if z else p.get("file_page_url"),
                "quality": z.get("quality"),
                "rights": {dt: service.effective("image", img.image_id, dt, latest).status
                           for dt in ("image_rights", "image_publication", "image_reference_index")},
                "publishable": service.image_publishable(img.image_id, latest),
            }

        sections = {"published": [], "commons_candidates": [], "zip_gallery": [], "zip_review": [], "zip_proposed_here": []}
        for img in images.images:
            z = img.zip_import
            if img.monument_id == mid:
                if service.image_publishable(img.image_id, latest):
                    sections["published"].append(item(img))
                elif (img.provenance or {}).get("candidate_batch"):
                    sections["commons_candidates"].append(item(img))
                elif z and not img.zip_identity_conflict:
                    sections["zip_gallery"].append(item(img))
                elif z:
                    sections["zip_review"].append(item(img))
            elif z and z["identity"].get("proposed_monument_id") == mid:
                sections["zip_proposed_here"].append(item(img))
        return {"monument_id": mid, "name": name, "public": False, "sections": sections,
                "zip_rights": next((i.zip_import["rights"] for i in images.images if i.zip_import), None)}

    @router.get("/review/audit")
    def audit_log(limit: Annotated[int, Query(ge=1, le=1000)] = 200):
        return {"entries": store.audit_entries(limit), "verification": store.verify_audit_chain()}

    @router.get("/review/location-candidates")
    def location_candidates():
        """Tüm koordinat adaylarının karşılaştırmalı tablosu. Hiçbir adayı doğrulamaz."""
        latest = store.latest_all()
        status = {mid: service.effective_location(mid, latest).status for mid in catalog.monuments}
        rows = candidate_rows(service.research, status)
        return {
            "candidates": rows,
            "flag_labels": FLAG_LABELS,
            "monuments_with_candidates": len({r["monument_id"] for r in rows}),
            "verified": sum(s == "verified" for s in status.values()),
            "entry_points_available": sum(r["checkin_entry_point"] is not None for r in rows),
            "attribution": service.research.attribution,
        }

    @router.get("/review/publication-preview")
    def publication_preview():
        """Dışa aktarıcının şu anda yazacağı içerik (yalnızca sayılar). Hiçbir şey yayımlamaz."""
        latest = store.latest_all()
        snapshot, media = build_snapshot(service)
        return {
            "monuments_publishable": len(snapshot.monuments),
            "facts_publishable": sum(len(m.facts) for m in snapshot.monuments),
            "images_publishable": sum(len(m.images) for m in snapshot.monuments),
            "monuments": {mid: service.gates(mid, latest) for mid in catalog.monuments},
            "empty_reason": None if snapshot.monuments else "Henüz kimlik yayını onaylanmış eser yok.",
        }

    @router.post("/rag/ask")
    def rag_ask(body: AskRequest):
        return get_rag().ask(body.question)

    app.include_router(session_router)
    app.include_router(router)
    return app


def main(argv=None):
    parser = argparse.ArgumentParser(description="VAKIFNAME dahili API (yalnızca loopback)")
    parser.add_argument("--host", default="127.0.0.1", choices=sorted(LOOPBACK_HOSTS))
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)

    token = config.token_from_env()
    model_dir = os.environ.get("VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR")
    from .rag import OfflineEncoder

    app = create_internal_app(
        config.data_dir_from_env(), token, rag_encoder=OfflineEncoder(model_dir),
        research_file=config.research_file_from_env(),
        corroboration_file=config.corroboration_file_from_env(),
        commons_file=config.commons_images_file_from_env(),
        candidates_file=config.commons_candidates_file_from_env(),
        zip_overlay_file=config.hackathon_zip_overlay_file_from_env(),
        proposals_file=config.proposals_file_from_env(),
        publish_out=Path(os.environ["VAKIFNAME_PUBLIC_CATALOG_OUT"]) if os.environ.get("VAKIFNAME_PUBLIC_CATALOG_OUT") else None,
    )

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, proxy_headers=False, forwarded_allow_ips="")


if __name__ == "__main__":
    main()
