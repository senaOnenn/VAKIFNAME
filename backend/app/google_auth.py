"""Google ile giriş: kimlik belirteci (ID token) yalnızca sunucuda doğrulanır.

- İmza, Google'ın yayımladığı anahtarlarla (JWKS, `GOOGLE_CERTS_URL`) ve yalnızca RS256 ile denetlenir.
- `aud` = `VAKIFNAME_GOOGLE_CLIENT_ID`, `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}, süre (`exp`)
  dolmamış olmalı; `sub` ve `email` zorunlu, e-posta Google'ca doğrulanmış (`email_verified: true`) olmalı.
- İstemcinin bildirdiği e-posta veya ada güvenilmez; yalnızca doğrulanmış belirtecin içeriği kullanılır.
- Belirteç loglanmaz ve saklanmaz. `VAKIFNAME_GOOGLE_CLIENT_ID` yoksa doğrulayıcı kurulmaz ve uç 503 döner.
- Doğrulayıcı `app.state.google_verifier` üzerinden değiştirilebilir: testler sahte doğrulayıcı kullanır, ağa çıkmaz.
"""

import os
from dataclasses import dataclass
from typing import Optional, Protocol

import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError

from .accounts import normalize_email

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
MAX_NAME = 60


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    name: Optional[str] = None


class InvalidGoogleToken(Exception):
    """Belirteç geçersiz. `reason` yalnızca kısa bir koddur (log için); belirtecin kendisi yazılmaz."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class GoogleUnavailable(Exception):
    """Google'ın anahtarları alınamadı (ağ); istemcinin hatası değildir."""


class GoogleTokenVerifier(Protocol):
    def verify(self, id_token: str) -> GoogleIdentity: ...


def _clean_name(name) -> Optional[str]:
    if not isinstance(name, str):
        return None
    name = " ".join("".join(ch for ch in name if ch.isprintable()).split())[:MAX_NAME]
    return name or None


class GoogleVerifier:
    def __init__(self, client_id: str, jwks_client: Optional[PyJWKClient] = None, leeway_s: int = 30):
        if not client_id:
            raise ValueError("Google istemci kimliği boş olamaz.")
        self.client_id = client_id
        self.leeway_s = leeway_s
        # Anahtar kümesi ilk doğrulamada indirilir ve bir saat önbellekte kalır; bilinmeyen `kid` gelince yenilenir.
        self._jwks = jwks_client or PyJWKClient(GOOGLE_CERTS_URL, cache_jwk_set=True, lifespan=3600, timeout=5)

    def verify(self, id_token: str) -> GoogleIdentity:
        try:
            key = self._jwks.get_signing_key_from_jwt(id_token)
        except PyJWKClientConnectionError:
            raise GoogleUnavailable() from None
        except jwt.PyJWTError as e:
            raise InvalidGoogleToken(type(e).__name__) from None
        try:
            claims = jwt.decode(id_token, key.key, algorithms=["RS256"], audience=self.client_id, leeway=self.leeway_s,
                                options={"require": ["exp", "iat", "iss", "aud", "sub"]})
        except jwt.PyJWTError as e:
            raise InvalidGoogleToken(type(e).__name__) from None
        if claims.get("iss") not in GOOGLE_ISSUERS:
            raise InvalidGoogleToken("issuer")
        if claims.get("email_verified") not in (True, "true"):
            raise InvalidGoogleToken("email_not_verified")
        sub, email = claims.get("sub"), claims.get("email")
        if not isinstance(sub, str) or not 0 < len(sub) <= 255:
            raise InvalidGoogleToken("sub")
        if not isinstance(email, str) or not 3 <= len(email.strip()) <= 254 or "@" not in email:
            raise InvalidGoogleToken("email")
        return GoogleIdentity(sub=sub, email=normalize_email(email), name=_clean_name(claims.get("name")))


def google_verifier_from_env() -> Optional[GoogleVerifier]:
    """`VAKIFNAME_GOOGLE_CLIENT_ID` tanımlıysa gerçek doğrulayıcı; değilse None (Google ile giriş kapalı, uç 503)."""
    client_id = os.environ.get("VAKIFNAME_GOOGLE_CLIENT_ID", "").strip()
    return GoogleVerifier(client_id) if client_id else None
