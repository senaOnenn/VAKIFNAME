"""Hesap sistemi: kullanıcılar ve oturumlar (kalıcı SQLite).

- **Parola** yalnızca scrypt özeti olarak saklanır (stdlib `hashlib.scrypt`, n=2^14, r=8, p=1, 16 bayt rastgele tuz).
  Özet dizgisi parametreleri de taşır (`scrypt$<n>$<r>$<p>$<tuz>$<özet>`): parametreler ileride artırılsa da eski
  özetler doğrulanmaya devam eder. Karşılaştırma `hmac.compare_digest` ile yapılır.
- **Oturum belirteci** (`secrets.token_urlsafe(32)`) yalnızca tarayıcıdaki HttpOnly çerezde durur; sunucu yalnızca
  SHA-256 özetini tutar. Oturum 30 gün geçerlidir; çıkışta satır silinir, süresi dolan satır ilk görüldüğünde silinir.
- **Hesap kimliği** sunucuda üretilir: `u-<uuid4>`. Misafir kimlikleri (`ziyaretci-…`) bu ad alanına giremez.
- **Hesap silme (KVKK):** oturumlar silinir; e-posta, parola özeti, Google kimliği ve görünen ad boşaltılır. Geriye
  kişisel veri içermeyen rastgele kimlik ve tarihler (`deleted_at`) kalır; e-posta yeniden kayıt için serbest kalır.
"""

import base64
import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Callable, Literal, Optional

Provider = Literal["password", "google"]

SESSION_TTL = timedelta(days=30)
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1
_SCRYPT_MAXMEM = 64 * 1024 * 1024  # n=2^14, r=8 yaklaşık 16 MiB kullanır; ileride parametre artışına pay bırakır
_LAST_SEEN_EVERY = timedelta(minutes=5)  # her istekte yazmamak için son görülme en fazla bu sıklıkla güncellenir
MAX_TOKEN_LEN = 128

# Sunucunun ürettiği hesap kimliğinin biçimi (`u-` + uuid4). İlerleme uçları bu biçimdeki kimliği oturumla korur.
ACCOUNT_ID_RE = re.compile(r"^u-[0-9a-f-]{36}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    display_name TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
    token_sha256 TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL CHECK (provider IN ('password', 'google')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
"""


class EmailTaken(Exception):
    """Bu e-posta adresiyle silinmemiş bir hesap zaten var."""


class GoogleAccountConflict(Exception):
    """E-posta eşleşen hesap başka bir Google hesabına bağlı."""


def is_account_id(user_id: str) -> bool:
    return bool(ACCOUNT_ID_RE.match(user_id))


def normalize_email(email: str) -> str:
    return email.strip().lower()


# --- Parola özeti -------------------------------------------------------------------------------------------------

def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _password_bytes(password: str) -> bytes:
    # Aynı parola farklı cihazda farklı Unicode biçimiyle gelebilir (ör. "ş" tek karakter ya da "s" + çengel).
    return unicodedata.normalize("NFKC", password).encode("utf-8")


def hash_password(password: str, *, n: int = SCRYPT_N, r: int = SCRYPT_R, p: int = SCRYPT_P) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(_password_bytes(password), salt=salt, n=n, r=r, p=p, dklen=32, maxmem=_SCRYPT_MAXMEM)
    return f"scrypt${n}${r}${p}${_b64(salt)}${_b64(dk)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, n, r, p, salt, dk = encoded.split("$")
        if algo != "scrypt":
            return False
        expected = _unb64(dk)
        actual = hashlib.scrypt(_password_bytes(password), salt=_unb64(salt), n=int(n), r=int(r), p=int(p),
                                dklen=len(expected), maxmem=_SCRYPT_MAXMEM)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    return hash_password(secrets.token_urlsafe(16))


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --- Depo ---------------------------------------------------------------------------------------------------------

class AccountStore:
    def __init__(self, path: Optional[Path] = None, clock: Callable[[], datetime] = _utcnow):
        # Yol verilmezse bellek içi depo (testler). Üretimde dosya yolu verilir; dosya yalnızca sahibince okunur.
        target = ":memory:"
        if path is not None:
            p = Path(path)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.touch(mode=0o600, exist_ok=True)
            target = str(p)
        self._db = sqlite3.connect(target, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        if path is not None:
            self._db.execute("PRAGMA journal_mode = WAL")
        self._db.executescript(SCHEMA)
        self._lock = threading.Lock()
        self.clock = clock

    def close(self):
        with self._lock:
            self._db.close()

    def _now(self) -> datetime:
        return self.clock().astimezone(timezone.utc).replace(microsecond=0)

    def _user(self, sql: str, args: tuple) -> Optional[dict]:
        row = self._db.execute(f"SELECT * FROM users WHERE deleted_at IS NULL AND {sql}", args).fetchone()
        return dict(row) if row else None

    def get_user(self, user_id: str) -> Optional[dict]:
        with self._lock:
            return self._user("id=?", (user_id,))

    def _insert_user(self, email: str, password_hash: Optional[str], google_sub: Optional[str],
                     display_name: Optional[str]) -> dict:
        # Çağıran kilidi tutar.
        if self._user("email=?", (email,)) is not None:
            raise EmailTaken()
        user_id = f"u-{uuid.uuid4()}"
        try:
            self._db.execute(
                "INSERT INTO users (id, email, password_hash, google_sub, display_name, created_at) VALUES (?,?,?,?,?,?)",
                (user_id, email, password_hash, google_sub, display_name, self._now().isoformat()))
        except sqlite3.IntegrityError:
            # Aynı dosyayı paylaşan başka bir süreç aynı e-postayı aynı anda kaydetmiş olabilir.
            raise EmailTaken() from None
        return self._user("id=?", (user_id,))

    def create_user(self, email: str, password: str, display_name: Optional[str] = None) -> dict:
        email = normalize_email(email)
        # scrypt kilit dışında hesaplanır; aksi halde her kayıt bütün hesap işlemlerini ~50 ms bekletir.
        password_hash = hash_password(password)
        with self._lock:
            return self._insert_user(email, password_hash, None, display_name)

    def authenticate(self, email: str, password: str) -> Optional[dict]:
        """E-posta ve parola doğruysa kullanıcı; değilse None. Hesap yoksa veya parolasızsa (yalnızca Google) da aynı
        sürede None döner: cevap süresinden e-postanın kayıtlı olup olmadığı anlaşılmaz."""
        with self._lock:
            user = self._user("email=?", (normalize_email(email),))
        encoded = user["password_hash"] if user and user["password_hash"] else None
        ok = verify_password(password, encoded or _dummy_hash())
        return user if ok and encoded else None

    def google_sign_in(self, sub: str, email: str, display_name: Optional[str] = None) -> dict:
        """Google kimliğiyle (doğrulanmış `sub` ve e-posta) kullanıcıyı bulur, aynı e-postalı hesaba bağlar ya da açar."""
        email = normalize_email(email)
        with self._lock:
            user = self._user("google_sub=?", (sub,))
            if user is not None:
                return user
            user = self._user("email=?", (email,))
            if user is not None:
                if user["google_sub"] is not None:
                    raise GoogleAccountConflict()
                # Önceden hesap ele geçirme önlemi: parolalı kayıtta e-posta doğrulanmaz. Google e-postanın sahibini
                # doğruladığı için bağlama anında doğrulanmamış parola silinir ve hesabın açık oturumları kapatılır;
                # böylece e-postayı önceden kaydeden üçüncü kişi hesaba parolayla girmeye devam edemez.
                self._db.execute("BEGIN IMMEDIATE")
                try:
                    self._db.execute("UPDATE users SET google_sub=?, password_hash=NULL WHERE id=?", (sub, user["id"]))
                    self._db.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
                    self._db.execute("COMMIT")
                except BaseException:
                    self._db.execute("ROLLBACK")
                    raise
                return self._user("id=?", (user["id"],))
            return self._insert_user(email, None, sub, display_name)

    def delete_user(self, user_id: str) -> None:
        """Oturumları siler ve kişisel alanları boşaltır (bkz. modül açıklaması). İlerleme ayrı depodadır."""
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
                self._db.execute("UPDATE users SET email=NULL, password_hash=NULL, google_sub=NULL, display_name=NULL, "
                                 "deleted_at=? WHERE id=? AND deleted_at IS NULL", (self._now().isoformat(), user_id))
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise

    # --- Oturumlar ----------------------------------------------------------------------------------------------

    def create_session(self, user_id: str, provider: Provider) -> str:
        token = secrets.token_urlsafe(32)
        now = self._now()
        with self._lock:
            self._db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now.isoformat(),))
            self._db.execute(
                "INSERT INTO sessions (token_sha256, user_id, provider, created_at, expires_at, last_seen_at) "
                "VALUES (?,?,?,?,?,?)",
                (_token_digest(token), user_id, provider, now.isoformat(), (now + SESSION_TTL).isoformat(), now.isoformat()))
        return token

    def session_user(self, token: Optional[str]) -> Optional[dict]:
        """Geçerli oturumun kullanıcısı (`provider` alanıyla birlikte) ya da None."""
        if not token or len(token) > MAX_TOKEN_LEN:
            return None
        digest = _token_digest(token)
        now = self._now()
        with self._lock:
            row = self._db.execute(
                "SELECT s.provider, s.expires_at, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token_sha256=? AND u.deleted_at IS NULL", (digest,)).fetchone()
            if row is None:
                return None
            if datetime.fromisoformat(row["expires_at"]) <= now:
                self._db.execute("DELETE FROM sessions WHERE token_sha256=?", (digest,))
                return None
            if now - datetime.fromisoformat(row["last_seen_at"]) >= _LAST_SEEN_EVERY:
                self._db.execute("UPDATE sessions SET last_seen_at=? WHERE token_sha256=?", (now.isoformat(), digest))
        user = dict(row)
        for k in ("expires_at", "last_seen_at"):
            user.pop(k)
        return user

    def delete_session(self, token: Optional[str]) -> None:
        if token and len(token) <= MAX_TOKEN_LEN:
            with self._lock:
                self._db.execute("DELETE FROM sessions WHERE token_sha256=?", (_token_digest(token),))
