"""Hesap sistemi genel API'si: e-posta+parola ve Google ile giriş, oturum çerezi, hesap silme (KVKK).

- Oturum `vk_session` çereziyle taşınır: HttpOnly, SameSite=Lax, Path=/, 30 gün. `Secure` bayrağı
  `VAKIFNAME_COOKIE_SECURE` ile verilir (`1` her zaman, `0` hiç); tanımlı değilse HTTPS isteklerinde kendiliğinden konur.
  Lax çerez başka sitelerden gelen POST/DELETE isteklerinde gönderilmez; gövde yalnızca JSON kabul edildiği için düz HTML
  formuyla da giriş yaptırılamaz.
- Girişte yanlış parola, kayıtlı olmayan e-posta ve parolasız (yalnızca Google) hesap aynı cevabı alır; e-postanın
  kayıtlı olup olmadığı girişten anlaşılmaz.
- Google kimlik belirteci yalnızca sunucuda doğrulanır (bkz. `google_auth.py`).
- Misafir ilerlemesi (`visitor_id`, tarayıcıda üretilen `ziyaretci-<uuid>`) giriş/kayıt anında hesaba taşınır (K8).
- Hesap kimliğiyle (`u-…`) tutulan ilerleme yalnızca o hesabın oturumuyla okunur ve yazılır (`require_progress_access`).
- Parola, oturum belirteci ve Google belirteci loglanmaz; yanıtta geri yazılmaz (422 hatalarında da girdi gösterilmez).
- **E-posta doğrulama ve parola yenileme** (29 Ekim kararı): bağlantı e-postayla gider (`app/mailer.py`), belirteç
  adresin `#t=` parçasındadır. Gönderim arka plan görevidir; parola yenileme isteği hesap olsa da olmasa da aynı 204
  cevabını alır ve hesap araması da arka planda yapılır: cevaptan veya süresinden e-postanın kayıtlı olduğu anlaşılmaz.
  Aynı adrese/hesaba giden e-postalar ayrıca sınırlanır (aşılınca sessizce gönderilmez).
"""

import logging
import os
import re
from typing import Annotated, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from .admin import is_admin
from .accounts import SESSION_TTL, AccountStore, EmailTaken, GoogleAccountConflict, Provider, is_account_id, normalize_email
from .google_auth import GoogleUnavailable, InvalidGoogleToken
from .mailer import deliver, reset_mail, verification_mail

router = APIRouter(tags=["auth"])
log = logging.getLogger("vakifname.auth")

SESSION_COOKIE = "vk_session"
LOGIN_FAILED = "E-posta veya parola hatalı."
NOT_SIGNED_IN = "Oturum açık değil."
LINK_INVALID = "Bağlantı geçersiz, kullanılmış ya da süresi dolmuş. Yeni bir bağlantı isteyin."

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
VISITOR_ID_PATTERN = r"^ziyaretci-[0-9a-f-]{36}$"


def _email(v: str) -> str:
    v = normalize_email(v)
    if _CONTROL.search(v) or len(v) > 254 or not _EMAIL.match(v):
        raise ValueError("Geçerli bir e-posta adresi girin.")
    return v


def _display_name(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    if _CONTROL.search(v):
        raise ValueError("Ad kontrol karakteri içeremez.")
    return " ".join(v.split()) or None


Email = Annotated[str, Field(min_length=3, max_length=254), AfterValidator(_email)]
VisitorId = Annotated[str, StringConstraints(pattern=VISITOR_ID_PATTERN)]


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: Email
    password: str = Field(min_length=8, max_length=128)
    display_name: Annotated[Optional[str], Field(max_length=60), AfterValidator(_display_name)] = None
    visitor_id: Optional[VisitorId] = None


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: Email
    # Girişte alt sınır yok: kayıt kuralı ileride sıkılaşırsa eski parolalar 422 ile kilitlenmesin; kısa parola zaten
    # eşleşmez ve genel 401 cevabını alır.
    password: str = Field(min_length=1, max_length=128)
    visitor_id: Optional[VisitorId] = None


EmailLinkToken = Annotated[str, StringConstraints(min_length=20, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]


class VerifyEmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: EmailLinkToken


class PasswordResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: Email


class PasswordResetConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: EmailLinkToken
    password: str = Field(min_length=8, max_length=128)  # kayıttaki kural
    visitor_id: Optional[VisitorId] = None


class GoogleLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id_token: str = Field(min_length=10, max_length=4096)
    visitor_id: Optional[VisitorId] = None


def _accounts(request: Request) -> AccountStore:
    return request.app.state.accounts


def _cookie_secure(request: Request) -> bool:
    forced = os.environ.get("VAKIFNAME_COOKIE_SECURE", "").strip()
    return forced == "1" if forced in ("0", "1") else request.url.scheme == "https"


def _limit(request: Request):
    client = request.client.host if request.client else "unknown"
    retry = request.app.state.auth_limiter.check(client)
    if retry is not None:
        raise HTTPException(status_code=429, detail="Çok fazla deneme; lütfen biraz sonra tekrar deneyin.",
                            headers={"Retry-After": str(retry)})


def _public(user: dict, provider: str) -> dict:
    return {"user_id": user["id"], "email": user["email"], "display_name": user["display_name"], "provider": provider,
            "email_verified": bool(user.get("email_verified_at")), "is_admin": is_admin(user)}


def _mail_allowed(request: Request, key: str) -> bool:
    """Aynı adrese/hesaba giden e-posta sınırı (istemci sınırından ayrı). Aşılınca e-posta sessizce gönderilmez."""
    return request.app.state.mail_limiter.check(key) is None


def _send_verification(app, user_id: str, email: str):
    token = app.state.accounts.issue_email_token(user_id, "verify")
    hours = int(app.state.accounts.token_ttls["verify"].total_seconds() // 3600)
    deliver(app.state.mailer, email, verification_mail(app.state.public_base_url, token, hours))


def _send_reset(app, email: str):
    # Hesap araması da burada (yanıttan sonra) yapılır: yanıt süresi hesabın varlığına göre değişmez.
    user = app.state.accounts.get_user_by_email(email)
    if user is None:
        return
    token = app.state.accounts.issue_email_token(user["id"], "reset")
    minutes = int(app.state.accounts.token_ttls["reset"].total_seconds() // 60)
    deliver(app.state.mailer, user["email"], reset_mail(app.state.public_base_url, token, minutes))


def _signed_in(request: Request, response: Response, user: dict, provider: Provider, visitor_id: Optional[str]) -> dict:
    if visitor_id:
        # Bu cihazda misafirken toplanan ilerleme hesaba taşınır; hesapta aynı kayıt varsa hesabınki kalır.
        request.app.state.monument_progress.merge_user(visitor_id, user["id"])
    token = _accounts(request).create_session(user["id"], provider)
    response.set_cookie(SESSION_COOKIE, token, max_age=int(SESSION_TTL.total_seconds()), path="/", httponly=True,
                        samesite="lax", secure=_cookie_secure(request))
    response.headers["Cache-Control"] = "no-store"
    return _public(user, provider)


def _clear_cookie(request: Request, response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=_cookie_secure(request))


def current_user(request: Request) -> Optional[dict]:
    return _accounts(request).session_user(request.cookies.get(SESSION_COOKIE))


def require_progress_access(request: Request, user_id: Optional[str]):
    """Hesap kimliğiyle (`u-<uuid>`) tutulan ilerleme yalnızca aynı hesabın oturumuyla okunur/yazılır.

    Misafir kimlikleri (`ziyaretci-…`) ve hesap biçiminde olmayan diğer kimlikler eskisi gibi çalışır; hiçbir hesap bu
    biçim dışında bir kimlik almadığı için onlar üzerinden hesap verisine erişilemez.
    """
    if not user_id or not is_account_id(user_id):
        return
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Bu hesabın ilerlemesi için oturum açmanız gerekir.")
    if user["id"] != user_id:
        raise HTTPException(status_code=403, detail="Bu ilerleme kaydına erişim izniniz yok.")


@router.post("/auth/register", status_code=201)
def register(body: RegisterRequest, request: Request, response: Response, background: BackgroundTasks):
    _limit(request)
    try:
        user = _accounts(request).create_user(body.email, body.password, body.display_name)
    except EmailTaken:
        raise HTTPException(status_code=409, detail="Bu e-posta adresiyle kayıtlı bir hesap zaten var.") from None
    if _mail_allowed(request, f"verify:{user['id']}"):
        background.add_task(_send_verification, request.app, user["id"], user["email"])
    return _signed_in(request, response, user, "password", body.visitor_id)


@router.post("/auth/verify-email/resend", status_code=204)
def resend_verification(request: Request, background: BackgroundTasks):
    _limit(request)
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail=NOT_SIGNED_IN)
    if user.get("email_verified_at"):
        return
    if not _mail_allowed(request, f"verify:{user['id']}"):
        raise HTTPException(status_code=429, detail="Bağlantı kısa süre önce gönderildi; lütfen biraz sonra tekrar "
                                                    "deneyin.", headers={"Retry-After": "60"})
    background.add_task(_send_verification, request.app, user["id"], user["email"])


@router.post("/auth/verify-email")
def verify_email(body: VerifyEmailRequest, request: Request, response: Response):
    """Oturum gerekmez (bağlantı başka cihazda açılabilir) ve oturum açmaz; yalnızca e-postayı doğrular."""
    _limit(request)
    user = _accounts(request).verify_email(body.token)
    if user is None:
        raise HTTPException(status_code=400, detail=LINK_INVALID)
    response.headers["Cache-Control"] = "no-store"
    return {"email": user["email"], "email_verified": True}


@router.post("/auth/password-reset/request", status_code=204)
def password_reset_request(body: PasswordResetRequest, request: Request, background: BackgroundTasks):
    _limit(request)
    if _mail_allowed(request, f"reset:{body.email}"):
        background.add_task(_send_reset, request.app, body.email)


@router.post("/auth/password-reset/confirm")
def password_reset_confirm(body: PasswordResetConfirm, request: Request, response: Response):
    _limit(request)
    user = _accounts(request).reset_password(body.token, body.password)
    if user is None:
        raise HTTPException(status_code=400, detail=LINK_INVALID)
    return _signed_in(request, response, user, "password", body.visitor_id)


@router.post("/auth/login")
def login(body: LoginRequest, request: Request, response: Response):
    _limit(request)
    user = _accounts(request).authenticate(body.email, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail=LOGIN_FAILED)
    return _signed_in(request, response, user, "password", body.visitor_id)


@router.post("/auth/google")
def google_login(body: GoogleLoginRequest, request: Request, response: Response):
    _limit(request)
    verifier = request.app.state.google_verifier
    if verifier is None:
        raise HTTPException(status_code=503, detail="Google ile giriş yapılandırılmadı.")
    try:
        identity = verifier.verify(body.id_token)
    except GoogleUnavailable:
        log.warning("Google anahtarları alınamadı; Google ile giriş geçici olarak yapılamıyor.")
        raise HTTPException(status_code=503, detail="Google ile giriş şu anda doğrulanamıyor; lütfen biraz sonra "
                                                    "tekrar deneyin.") from None
    except InvalidGoogleToken as e:
        # Yalnızca ret nedeni yazılır (ör. InvalidAudienceError: istemci kimliği yanlış yapılandırılmış olabilir).
        log.info("Google belirteci reddedildi: %s", e.reason)
        raise HTTPException(status_code=401, detail="Google kimliği doğrulanamadı.") from None
    try:
        user = _accounts(request).google_sign_in(identity.sub, identity.email, identity.name)
    except GoogleAccountConflict:
        raise HTTPException(status_code=409, detail="Bu e-posta adresi başka bir Google hesabına bağlı.") from None
    return _signed_in(request, response, user, "google", body.visitor_id)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response):
    _limit(request)
    _accounts(request).delete_session(request.cookies.get(SESSION_COOKIE))
    _clear_cookie(request, response)


@router.get("/auth/me")
def me(request: Request, response: Response):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail=NOT_SIGNED_IN)
    response.headers["Cache-Control"] = "no-store"
    return _public(user, user["provider"])


@router.delete("/auth/me", status_code=204)
def delete_me(request: Request, response: Response):
    """Hesabı siler (KVKK): önce ilerleme, sonra oturumlar ve kişisel alanlar. Yarıda kalırsa yeniden denenebilir."""
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail=NOT_SIGNED_IN)
    request.app.state.monument_progress.delete_user(user["id"])
    _accounts(request).delete_user(user["id"])
    _clear_cookie(request, response)
