"""Yapay zekâ tarih rehberi genel API'si (özellik bayrağı arkasında).

`VAKIFNAME_GUIDE_MODE`:
- `off` (varsayılan): uçlar 503 döner, arayüz bölümü eski kaynaklı arama olarak gösterir.
- `testers`: yalnızca test oturumu açmış tarayıcılar kullanır. Test anahtarı bir kez `POST /guide/session` gövdesinde
  gönderilir (URL'de veya başlıkta taşınmaz, loglanmaz); sunucu anahtarın kendisini değil, rastgele bir oturum kimliğini
  `HttpOnly` + `SameSite=Strict` çerezle verir (8 saat; sunucu yalnızca kimliğin özetini tutar, yeniden başlatmada
  oturumlar kapanır). Çerezli her istek ayrıca `X-Vakifname-Guide: 1` başlığı taşımalıdır: bu başlık CORS listesindeki
  origin'ler dışında gönderilemez (CSRF koruması). Test anahtarı `VAKIFNAME_GUIDE_TESTER_KEY_FILE` dosyasından
  (varsayılan `/etc/vakifname/secrets/guide_tester_key`, yalnızca sahibi okuyabilir) okunur; dosya yoksa kimse erişemez.
  Çerezin `Secure` bayrağı HTTPS isteklerinde kendiliğinden konur; TLS bir vekilde sonlanıyorsa
  `VAKIFNAME_GUIDE_COOKIE_SECURE=1` verilmelidir.
- `on`: bütün ziyaretçiler.

Soru metni, konuşma geçmişi ve fotoğraf loglanmaz, saklanmaz. Fotoğraf yalnızca istek süresince bellekte işlenir;
ziyaretçi fotoğrafta yüz, kişisel bilgi veya gizli belge olmadığını onaylamadan (`image.consent: true`) kabul edilmez ve
yerel yüz taramasında yüz bulunursa sağlayıcıya gönderilmeden reddedilir.
"""

import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .ask_routes import MAX_QUESTION, RateLimiter
from .guide import image as img
from .guide.secret import load_key
from .public_catalog import MonumentId

router = APIRouter(tags=["guide"])

CLIENT_HEADER = "X-Vakifname-Guide"
SESSION_COOKIE = "vakifname_guide_session"
SESSION_TTL_S = 8 * 3600
DEFAULT_TESTER_KEY_FILE = Path("/etc/vakifname/secrets/guide_tester_key")
MAX_BODY = 9 * 1024 * 1024
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean_text(v: str, minimum: int = 2) -> str:
    if _CONTROL.search(v):
        raise ValueError("Metin kontrol karakteri içeremez.")
    v = " ".join(v.split())
    if len(v) < minimum:
        raise ValueError("Soru çok kısa.")
    return v


class HistoryTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=MAX_QUESTION)
    answer: str = Field(default="", max_length=1500)

    @field_validator("question", "answer")
    @classmethod
    def _c(cls, v: str) -> str:
        return _clean_text(v, 0)


class GuideImage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: str = Field(min_length=16, max_length=(img.MAX_BYTES * 4) // 3 + 64)
    mime: Optional[Literal["image/jpeg", "image/png", "image/webp"]] = None
    # Ziyaretçi onayı: fotoğrafta insan yüzü, kişisel bilgi veya gizli belge yok.
    consent: Literal[True]


class GuideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=2, max_length=MAX_QUESTION)
    monument_id: Optional[MonumentId] = None
    history: list[HistoryTurn] = Field(default_factory=list, max_length=8)
    image: Optional[GuideImage] = None
    # en: yalnızca eserin onaylı İngilizce kayıtlarından İngilizce cevap (Faz 11).
    lang: Literal["tr", "en"] = "tr"

    @field_validator("question")
    @classmethod
    def _q(cls, v: str) -> str:
        return _clean_text(v)


def guide_mode() -> str:
    mode = os.environ.get("VAKIFNAME_GUIDE_MODE", "off").strip().lower()
    return mode if mode in ("off", "testers", "on") else "off"


class TesterSessions:
    """Bellek içi test oturumları: yalnızca oturum kimliğinin SHA-256 özeti ve bitiş zamanı tutulur."""

    def __init__(self, ttl_s: float = SESSION_TTL_S, clock=time.monotonic, max_sessions: int = 1000):
        self.ttl_s, self.clock, self.max_sessions = ttl_s, clock, max_sessions
        self._sessions: dict[bytes, float] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _digest(sid: str) -> bytes:
        return hashlib.sha256(sid.encode()).digest()

    def create(self) -> str:
        sid = secrets.token_urlsafe(32)
        now = self.clock()
        with self._lock:
            self._sessions = {k: v for k, v in self._sessions.items() if v > now}
            if len(self._sessions) >= self.max_sessions:
                self._sessions.pop(min(self._sessions, key=self._sessions.get))
            self._sessions[self._digest(sid)] = now + self.ttl_s
        return sid

    def valid(self, sid: Optional[str]) -> bool:
        if not sid or len(sid) > 128:
            return False
        with self._lock:
            exp = self._sessions.get(self._digest(sid))
        return exp is not None and exp > self.clock()

    def drop(self, sid: Optional[str]):
        if sid:
            with self._lock:
                self._sessions.pop(self._digest(sid), None)


class InFlight:
    """Aynı oturumdan (test modunda çerez, açık modda istemci adresi) aynı anda yalnızca bir rehber isteği işlenir.
    Arayüzün zaman aşımından sonra yeniden gönderilen veya çift tıklanan soru, ilki sürerken ikinci bir sağlayıcı
    çağrısı (ve kota) harcamaz. Anahtar olarak yalnızca özet tutulur."""

    def __init__(self):
        self._keys: set[bytes] = set()
        self._lock = threading.Lock()

    def acquire(self, who: str) -> Optional[bytes]:
        key = hashlib.sha256(who.encode()).digest()
        with self._lock:
            if key in self._keys:
                return None
            self._keys.add(key)
        return key

    def release(self, key: bytes):
        with self._lock:
            self._keys.discard(key)


def _tester_key_matches(sent: str) -> bool:
    key, _ = load_key(Path(os.environ.get("VAKIFNAME_GUIDE_TESTER_KEY_FILE", str(DEFAULT_TESTER_KEY_FILE))))
    if key is None:
        return False
    return hmac.compare_digest(hashlib.sha256(sent.encode()).digest(), hashlib.sha256(key.encode()).digest())


def _tester_ok(request: Request) -> bool:
    return (request.headers.get(CLIENT_HEADER) == "1"
            and request.app.state.guide_sessions.valid(request.cookies.get(SESSION_COOKIE)))


def _access(request: Request) -> bool:
    mode = request.app.state.guide_mode
    return mode == "on" or (mode == "testers" and _tester_ok(request))


def _service(request: Request):
    if not _access(request):
        raise HTTPException(status_code=503, detail="Yapay zekâ rehberi şu anda kapalı.")
    return request.app.state.guide


@router.get("/guide/status")
def guide_status(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if not _access(request):
        # Test modunda arayüz, test anahtarının girileceği formu gösterebilsin diye yalnızca bu bilgi verilir.
        return {"enabled": False, "tester_login": request.app.state.guide_mode == "testers"}
    s = request.app.state.guide.status()
    # Genel yanıtta yalnızca açık/kapalı ve yetenekler; bütçe ayrıntısı ve hata türü test anahtarıyla görülür.
    out = {"enabled": True, "configured": s["configured"], "photo": s["photo_enabled"], "circuit_open": s["circuit"]["open"],
           "max_image_mb": img.MAX_BYTES // (1024 * 1024), "remaining_today": s["budget"]["remaining_calls"],
           "deadline_s": int(s["deadline_s"])}
    if request.app.state.guide_mode == "testers":
        out["tester"] = True
        out["detail"] = s
    return out


class SessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=16, max_length=256)


def _cookie_secure(request: Request) -> bool:
    forced = os.environ.get("VAKIFNAME_GUIDE_COOKIE_SECURE", "").strip()
    return forced == "1" if forced in ("0", "1") else request.url.scheme == "https"


@router.post("/guide/session", status_code=204)
def open_tester_session(body: SessionRequest, request: Request, response: Response):
    if request.app.state.guide_mode != "testers":
        raise HTTPException(status_code=404, detail="Test erişimi kapalı.")
    if request.headers.get(CLIENT_HEADER) != "1":
        raise HTTPException(status_code=401, detail="Geçersiz istek.")
    client = request.client.host if request.client else "unknown"
    retry = request.app.state.guide_login_limiter.check(client)
    if retry is not None:
        raise HTTPException(status_code=429, detail="Çok fazla deneme; lütfen biraz sonra tekrar deneyin.",
                            headers={"Retry-After": str(retry)})
    if not _tester_key_matches(body.key):
        raise HTTPException(status_code=401, detail="Test anahtarı geçersiz.")
    sessions: TesterSessions = request.app.state.guide_sessions
    response.set_cookie(SESSION_COOKIE, sessions.create(), max_age=int(sessions.ttl_s), path="/guide", httponly=True,
                        samesite="strict", secure=_cookie_secure(request))
    response.headers["Cache-Control"] = "no-store"


@router.delete("/guide/session", status_code=204)
def close_tester_session(request: Request, response: Response):
    request.app.state.guide_sessions.drop(request.cookies.get(SESSION_COOKIE))
    response.delete_cookie(SESSION_COOKIE, path="/guide", httponly=True, samesite="strict", secure=_cookie_secure(request))


@router.post("/guide/ask")
def guide_ask(body: GuideRequest, request: Request, response: Response):
    service = _service(request)
    client = request.client.host if request.client else "unknown"
    retry = request.app.state.guide_limiter.check(client)
    if retry is not None:
        raise HTTPException(status_code=429, detail="Çok fazla soru gönderildi; lütfen biraz sonra tekrar deneyin.",
                            headers={"Retry-After": str(retry)})
    engine = service.ask_service.engine()
    if body.monument_id and body.monument_id not in engine.corpus.monuments:
        raise HTTPException(status_code=404, detail="Eser bulunamadı veya henüz yayımlanmadı.")
    inflight: InFlight = request.app.state.guide_inflight
    slot = inflight.acquire(request.cookies.get(SESSION_COOKIE) or client)
    if slot is None:
        raise HTTPException(status_code=409, detail="Önceki sorunuz hâlâ yanıtlanıyor; lütfen o cevabı bekleyin.")
    try:
        image_bytes = img.decode_base64(body.image.data) if body.image is not None else None
        # Geçersiz dosya veya yüz içeren fotoğraf, sağlayıcıya herhangi bir çağrı yapılmadan reddedilir.
        result = service.ask(body.question, body.monument_id, [h.model_dump() for h in body.history], image_bytes,
                             lang=body.lang)
    except img.ImageRejected as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    finally:
        inflight.release(slot)
    result.pop("_removed", None)
    response.headers["Cache-Control"] = "no-store"
    return {"question": body.question, **result}


class BodyLimit:
    """`/guide/ask` gövdesi için `MAX_BODY` sınırı (Content-Length ve akış); diğer uçlar etkilenmez."""

    def __init__(self, app, limit: int = MAX_BODY):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") != "/guide/ask":
            return await self.app(scope, receive, send)
        limit = self.limit
        length = next((v for k, v in scope.get("headers", []) if k == b"content-length"), None)
        if length is not None and length.isdigit() and int(length) > limit:
            return await _too_large(send)
        seen = 0

        async def limited():
            nonlocal seen
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > limit:
                    raise _TooLarge()
            return msg

        try:
            return await self.app(scope, limited, send)
        except _TooLarge:
            return await _too_large(send)


class _TooLarge(Exception):
    pass


async def _too_large(send):
    body = '{"detail":"İstek çok büyük."}'.encode()
    await send({"type": "http.response.start", "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})
