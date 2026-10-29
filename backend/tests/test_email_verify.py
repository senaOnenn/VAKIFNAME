"""E-posta doğrulama ve parola yenileme (29 Ekim kararı): tek kullanımlık, süreli, amaca bağlı bağlantılar; belirteç
yalnızca özetle saklanır ve adresin parçasında (`#t=`) taşınır; parola yenileme isteği hesabın varlığını sızdırmaz;
yönetici yetkisi doğrulanmış e-posta ister; Google bağlama doğrulanmış hesabın parolasını korur."""

import json
import logging
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from email import message_from_bytes, policy
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from app import mailer as mailer_mod
from app.accounts import AccountStore
from app.ask_routes import RateLimiter
from app.auth_routes import LINK_INVALID, LOGIN_FAILED
from app.google_auth import GoogleIdentity, GoogleVerifier, InvalidGoogleToken
from app.main import create_app
from app.mailer import FileMailer, MailConfigError, SmtpMailer, mailer_from_env

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
PASSWORD = "Gizli-Parola-42"
NEW_PASSWORD = "Yepyeni-Parola-77"
BASE = "https://vakifname.example"
TOKEN_RE = re.compile(r"#t=([A-Za-z0-9_-]+)")


class Outbox:
    name = "outbox"

    def __init__(self):
        self.sent: list[dict] = []

    def send(self, to, subject, text, html_body):
        self.sent.append({"to": to, "subject": subject, "text": text, "html": html_body})

    def tokens(self, to=None) -> list[str]:
        return [TOKEN_RE.search(m["text"]).group(1) for m in self.sent if to is None or m["to"] == to]


class FakeGoogle:
    def __init__(self, tokens):
        self.tokens = tokens

    def verify(self, id_token):
        if id_token not in self.tokens:
            raise InvalidGoogleToken("unknown")
        return self.tokens[id_token]


class Clock:
    def __init__(self):
        self.now = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.now


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("VAKIFNAME_ACCOUNTS_DB", "VAKIFNAME_PROGRESS_DB", "VAKIFNAME_GOOGLE_CLIENT_ID", "VAKIFNAME_MAIL_DIR",
                 "VAKIFNAME_SMTP_HOST", "VAKIFNAME_MAIL_FROM", "VAKIFNAME_VERIFY_TTL_H", "VAKIFNAME_RESET_TTL_MIN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("VAKIFNAME_MAIL_BACKEND", "off")
    monkeypatch.setenv("VAKIFNAME_PUBLIC_BASE_URL", BASE + "/")
    monkeypatch.setenv("VAKIFNAME_AUTH_RATE", "100/1000/1000")
    monkeypatch.setenv("VAKIFNAME_ADMIN_EMAILS", "yonetici@example.com")


@pytest.fixture
def c():
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False)) as client:
        client.outbox = client.app.state.mailer = Outbox()
        client.clock = client.app.state.accounts.clock = Clock()
        yield client


def relax_mail_limit(c):
    c.app.state.mail_limiter = RateLimiter(per_minute=100, per_hour=100, global_per_minute=100)


def register(c, mail="ayse@example.com", password=PASSWORD):
    r = c.post("/auth/register", json={"email": mail, "password": password})
    assert r.status_code == 201, r.text
    return r.json()


# --- Doğrulama bağlantısı -----------------------------------------------------------------------------------------

def test_register_sends_fragment_link_and_verifies_once(c):
    user = register(c)
    assert user["email_verified"] is False and user["is_admin"] is False
    (mail,) = c.outbox.sent
    assert mail["to"] == "ayse@example.com" and "doğrula" in mail["subject"]
    token = c.outbox.tokens()[0]
    # Belirteç adresin parçasında: yol ve sorgu dizgisi temiz (sunucu loguna ve Referer'a gitmez); taban adres tek "/".
    assert f"{BASE}/dogrula#t={token}" in mail["text"] and f'href="{BASE}/dogrula#t={token}"' in mail["html"]
    assert "?" not in mail["text"].split(BASE, 1)[1].split()[0]
    # Ad e-postaya yazılmaz; sunucuda belirtecin açık hali yok.
    db = c.app.state.accounts._db
    assert db.execute("SELECT COUNT(*) FROM email_tokens WHERE token_hash=?", (token,)).fetchone()[0] == 0

    r = c.post("/auth/verify-email", json={"token": token})
    assert r.status_code == 200 and r.json() == {"email": "ayse@example.com", "email_verified": True}
    assert r.headers["cache-control"] == "no-store"
    assert c.get("/auth/me").json()["email_verified"] is True
    again = c.post("/auth/verify-email", json={"token": token})
    assert again.status_code == 400 and again.json()["detail"] == LINK_INVALID


def test_verify_link_works_without_a_session_and_does_not_open_one(c):
    register(c)
    token = c.outbox.tokens()[0]
    other = TestClient(c.app)
    r = other.post("/auth/verify-email", json={"token": token})
    assert r.status_code == 200 and "set-cookie" not in r.headers
    assert other.get("/auth/me").status_code == 401


def test_verify_link_expires_after_ttl(c):
    register(c)
    token = c.outbox.tokens()[0]
    c.clock.now += timedelta(hours=24)
    assert c.post("/auth/verify-email", json={"token": token}).status_code == 400
    assert c.get("/auth/me").json()["email_verified"] is False


def test_ttls_come_from_env(monkeypatch):
    monkeypatch.setenv("VAKIFNAME_VERIFY_TTL_H", "2")
    monkeypatch.setenv("VAKIFNAME_RESET_TTL_MIN", "5")
    app = create_app(public_catalog_file=SNAPSHOT, demo_api=False)
    assert app.state.accounts.token_ttls == {"verify": timedelta(hours=2), "reset": timedelta(minutes=5)}
    monkeypatch.setenv("VAKIFNAME_RESET_TTL_MIN", "0")
    with pytest.raises(ValueError):
        create_app(public_catalog_file=SNAPSHOT, demo_api=False)


def test_resend_requires_session_voids_older_link_and_is_rate_limited(c):
    assert c.post("/auth/verify-email/resend").status_code == 401
    register(c)
    first = c.outbox.tokens()[0]
    r = c.post("/auth/verify-email/resend")  # kayıt e-postası bu dakikanın hakkını kullandı
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
    relax_mail_limit(c)
    assert c.post("/auth/verify-email/resend").status_code == 204
    second = c.outbox.tokens()[1]
    assert c.post("/auth/verify-email", json={"token": first}).status_code == 400  # yenisi eskisini geçersiz kıldı
    assert c.post("/auth/verify-email", json={"token": second}).status_code == 200
    # Doğrulanmış hesaba yeniden gönderim: e-posta gitmez.
    assert c.post("/auth/verify-email/resend").status_code == 204 and len(c.outbox.sent) == 2


def test_tokens_are_bound_to_their_purpose(c):
    relax_mail_limit(c)
    register(c)
    verify_token = c.outbox.tokens()[0]
    assert c.post("/auth/password-reset/request", json={"email": "ayse@example.com"}).status_code == 204
    reset_token = c.outbox.tokens()[1]
    r = c.post("/auth/password-reset/confirm", json={"token": verify_token, "password": NEW_PASSWORD})
    assert r.status_code == 400 and "set-cookie" not in r.headers
    assert c.post("/auth/verify-email", json={"token": reset_token}).status_code == 400
    # Yanlış amaçla denemek belirteci yakmaz.
    assert c.post("/auth/verify-email", json={"token": verify_token}).status_code == 200


# --- Parola yenileme ----------------------------------------------------------------------------------------------

def test_reset_request_is_uniform_for_known_and_unknown_email(c):
    register(c)
    c.outbox.sent.clear()
    known = c.post("/auth/password-reset/request", json={"email": "AYSE@example.com"})
    unknown = c.post("/auth/password-reset/request", json={"email": "kimse@example.com"})
    assert known.status_code == unknown.status_code == 204
    assert known.content == unknown.content == b""
    assert sorted(known.headers.keys()) == sorted(unknown.headers.keys())
    assert [m["to"] for m in c.outbox.sent] == ["ayse@example.com"]
    assert "#t=" in c.outbox.sent[0]["text"] and "/sifre-yenile#t=" in c.outbox.sent[0]["text"]


def test_reset_request_is_silently_limited_per_email_and_429_per_client(c, monkeypatch):
    register(c)
    c.outbox.sent.clear()
    for _ in range(3):
        assert c.post("/auth/password-reset/request", json={"email": "ayse@example.com"}).status_code == 204
    assert len(c.outbox.sent) == 1  # aynı adrese dakikada bir e-posta; fazlası sessizce düşer
    c.app.state.auth_limiter = RateLimiter(per_minute=2, per_hour=10, global_per_minute=100)
    statuses = [c.post("/auth/password-reset/request", json={"email": f"k{i}@example.com"}).status_code
                for i in range(3)]
    assert statuses == [204, 204, 429]


def test_reset_confirm_sets_password_kills_all_sessions_and_signs_in(c):
    relax_mail_limit(c)
    user = register(c)
    other_device = TestClient(c.app)
    assert other_device.post("/auth/login", json={"email": "ayse@example.com", "password": PASSWORD}).status_code == 200
    stranger = TestClient(c.app)
    assert stranger.post("/auth/password-reset/request", json={"email": "ayse@example.com"}).status_code == 204
    token = c.outbox.tokens()[-1]

    r = stranger.post("/auth/password-reset/confirm", json={"token": token, "password": NEW_PASSWORD})
    assert r.status_code == 200 and r.json()["user_id"] == user["user_id"] and r.json()["email_verified"] is True
    assert "vk_session" in r.headers["set-cookie"]
    assert c.get("/auth/me").status_code == 401 and other_device.get("/auth/me").status_code == 401
    assert stranger.get("/auth/me").json()["user_id"] == user["user_id"]
    bad = c.post("/auth/login", json={"email": "ayse@example.com", "password": PASSWORD})
    assert bad.status_code == 401 and bad.json()["detail"] == LOGIN_FAILED
    assert c.post("/auth/login", json={"email": "ayse@example.com", "password": NEW_PASSWORD}).status_code == 200
    assert stranger.post("/auth/password-reset/confirm", json={"token": token, "password": PASSWORD}).status_code == 400
    # Bekleyen doğrulama bağlantısı da kapandı.
    assert c.post("/auth/verify-email", json={"token": c.outbox.tokens()[0]}).status_code == 400


def test_reset_link_expires_after_ttl(c):
    register(c)
    c.outbox.sent.clear()
    relax_mail_limit(c)
    c.post("/auth/password-reset/request", json={"email": "ayse@example.com"})
    token = c.outbox.tokens()[0]
    c.clock.now += timedelta(minutes=30)
    assert c.post("/auth/password-reset/confirm", json={"token": token, "password": NEW_PASSWORD}).status_code == 400


def test_reset_lets_google_only_account_set_a_password(c):
    c.app.state.google_verifier = FakeGoogle({"belirtec-g": GoogleIdentity("sub-g", "gul@example.com", "Gül")})
    assert c.post("/auth/google", json={"id_token": "belirtec-g"}).json()["email_verified"] is True
    c.post("/auth/logout")
    c.post("/auth/password-reset/request", json={"email": "gul@example.com"})
    token = c.outbox.tokens("gul@example.com")[0]
    assert c.post("/auth/password-reset/confirm", json={"token": token, "password": NEW_PASSWORD}).status_code == 200
    c.post("/auth/logout")
    assert c.post("/auth/login", json={"email": "gul@example.com", "password": NEW_PASSWORD}).status_code == 200


def test_reset_rejects_short_password_and_deleted_account(c):
    register(c)
    c.outbox.sent.clear()
    relax_mail_limit(c)
    c.post("/auth/password-reset/request", json={"email": "ayse@example.com"})
    token = c.outbox.tokens()[0]
    assert c.post("/auth/password-reset/confirm", json={"token": token, "password": "kisa"}).status_code == 422
    assert c.delete("/auth/me").status_code == 204
    db = c.app.state.accounts._db
    assert db.execute("SELECT COUNT(*) FROM email_tokens").fetchone()[0] == 0
    assert c.post("/auth/password-reset/confirm", json={"token": token, "password": NEW_PASSWORD}).status_code == 400
    # Silinmiş hesabın adresine yenileme e-postası gitmez.
    c.post("/auth/password-reset/request", json={"email": "ayse@example.com"})
    assert len(c.outbox.sent) == 1


@pytest.mark.parametrize("path, body", [
    ("/auth/verify-email", {"token": "kisa"}),
    ("/auth/verify-email", {"token": "x" * 129}),
    ("/auth/verify-email", {"token": "gecersiz karakter içeren belirtec!!"}),
    ("/auth/verify-email", {"token": "a" * 43, "email": "a@example.com"}),
    ("/auth/password-reset/request", {"email": "e-posta-degil"}),
    ("/auth/password-reset/request", {"email": "a@example.com", "fazla": 1}),
    ("/auth/password-reset/confirm", {"token": "a" * 43}),
    ("/auth/password-reset/confirm", {"token": "a" * 43, "password": "x" * 129}),
    ("/auth/password-reset/confirm", {"token": "a" * 43, "password": NEW_PASSWORD, "visitor_id": "u-1"}),
])
def test_strict_validation(c, path, body):
    r = c.post(path, json=body)
    assert r.status_code == 422 and "set-cookie" not in r.headers


# --- Yönetici ve Google -------------------------------------------------------------------------------------------

def test_admin_requires_verified_email(c):
    user = register(c, mail="yonetici@example.com")
    assert user["is_admin"] is False and c.get("/admin/stats").status_code == 403
    c.post("/auth/verify-email", json={"token": c.outbox.tokens()[0]})
    assert c.get("/auth/me").json()["is_admin"] is True and c.get("/admin/stats").status_code == 200


def test_google_link_keeps_password_and_sessions_of_verified_account(c):
    user = register(c)
    c.post("/auth/verify-email", json={"token": c.outbox.tokens()[0]})
    other_device = TestClient(c.app)
    other_device.post("/auth/login", json={"email": "ayse@example.com", "password": PASSWORD})
    c.app.state.google_verifier = FakeGoogle({"belirtec-a": GoogleIdentity("sub-a", "ayse@example.com")})
    google = TestClient(c.app)
    assert google.post("/auth/google", json={"id_token": "belirtec-a"}).json()["user_id"] == user["user_id"]
    assert c.get("/auth/me").status_code == 200 and other_device.get("/auth/me").status_code == 200
    assert c.app.state.accounts.get_user(user["user_id"])["password_hash"] is not None


def test_google_link_clears_unverified_password_and_marks_verified(c):
    user = register(c)
    pending = c.outbox.tokens()[0]
    c.app.state.google_verifier = FakeGoogle({"belirtec-a": GoogleIdentity("sub-a", "ayse@example.com")})
    google = TestClient(c.app)
    r = google.post("/auth/google", json={"id_token": "belirtec-a"})
    assert r.json()["user_id"] == user["user_id"] and r.json()["email_verified"] is True
    assert c.get("/auth/me").status_code == 401
    assert c.app.state.accounts.get_user(user["user_id"])["password_hash"] is None
    # Önceki kayıt sahibinin bekleyen bağlantısı da düştü.
    assert c.post("/auth/verify-email", json={"token": pending}).status_code == 400


def test_google_token_with_unverified_email_is_rejected_at_the_endpoint(c):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    jwks = jwt.PyJWKClient("https://example.invalid/certs")
    jwks.fetch_data = lambda: {"keys": [{**jwk, "kid": "k1", "alg": "RS256", "use": "sig"}]}
    c.app.state.google_verifier = GoogleVerifier("istemci.apps.googleusercontent.com", jwks_client=jwks)
    now = int(time.time())
    token = jwt.encode({"iss": "https://accounts.google.com", "aud": "istemci.apps.googleusercontent.com", "sub": "42",
                        "email": "dogrulanmamis@example.com", "email_verified": False, "iat": now, "exp": now + 600},
                       key, algorithm="RS256", headers={"kid": "k1"})
    assert c.post("/auth/google", json={"id_token": token}).status_code == 401
    assert c.app.state.accounts.get_user_by_email("dogrulanmamis@example.com") is None


# --- E-posta yolları, loglar, şema göçü ---------------------------------------------------------------------------

def test_file_backend_writes_private_eml_with_fragment_link(tmp_path, monkeypatch):
    monkeypatch.setenv("VAKIFNAME_MAIL_BACKEND", "file")
    monkeypatch.setenv("VAKIFNAME_MAIL_DIR", str(tmp_path / "posta"))
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False)) as c:
        assert isinstance(c.app.state.mailer, FileMailer)
        register(c, mail="dosya@example.com")
    (path,) = list((tmp_path / "posta").glob("*.eml"))
    assert (path.stat().st_mode & 0o777) == 0o600
    msg = message_from_bytes(path.read_bytes(), policy=policy.default)
    assert msg["To"] == "dosya@example.com" and msg.is_multipart()
    text = msg.get_body(preferencelist=("plain",)).get_content()
    assert re.search(rf"{re.escape(BASE)}/dogrula#t=[A-Za-z0-9_-]{{40,}}", text)


def test_no_token_or_link_reaches_the_logs(c, caplog):
    caplog.set_level(logging.DEBUG)
    relax_mail_limit(c)
    register(c)
    c.post("/auth/password-reset/request", json={"email": "ayse@example.com"})
    c.post("/auth/password-reset/request", json={"email": "kimse@example.com"})
    for token in c.outbox.tokens():
        assert token not in caplog.text
    assert "#t=" not in caplog.text and "ayse@example.com" not in caplog.text


def test_send_failure_is_logged_by_type_only(c, caplog):
    class Broken:
        name = "broken"

        def send(self, *a):
            raise OSError("smtp.example.com reddetti: ayse@example.com")

    c.app.state.mailer = Broken()
    caplog.set_level(logging.WARNING)
    assert register(c)["email_verified"] is False  # kayıt yine de tamamlanır
    assert "OSError" in caplog.text and "ayse@example.com" not in caplog.text


def test_old_users_table_without_column_is_migrated(tmp_path):
    db = tmp_path / "eski.sqlite3"
    con = sqlite3.connect(db)
    con.executescript("""
        CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, google_sub TEXT UNIQUE,
                            display_name TEXT, created_at TEXT NOT NULL, deleted_at TEXT);
    """)
    store = AccountStore(tmp_path / "gecici.sqlite3")
    user = store.create_user("eski@example.com", PASSWORD)
    con.execute("INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)",
                (user["id"], "eski@example.com", user["password_hash"], user["created_at"]))
    con.commit()
    con.close()
    store.close()
    migrated = AccountStore(db)
    assert migrated.authenticate("eski@example.com", PASSWORD)["email_verified_at"] is None
    token = migrated.issue_email_token(user["id"], "verify")
    assert migrated.verify_email(token)["email_verified_at"]
    migrated.close()
    assert AccountStore(db).get_user(user["id"])["email_verified_at"]  # ikinci açılışta göç tekrar denenmez


def test_mailer_config_is_validated(monkeypatch):
    monkeypatch.setenv("VAKIFNAME_MAIL_BACKEND", "posta-guvercini")
    with pytest.raises(MailConfigError):
        mailer_from_env()
    monkeypatch.setenv("VAKIFNAME_MAIL_BACKEND", "smtp")
    with pytest.raises(MailConfigError):
        mailer_from_env()
    monkeypatch.setenv("VAKIFNAME_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("VAKIFNAME_MAIL_FROM", "VAKIFNAME <noreply@example.com>")
    monkeypatch.setenv("VAKIFNAME_SMTP_SECURITY", "duz")
    with pytest.raises(MailConfigError):
        mailer_from_env()
    monkeypatch.setenv("VAKIFNAME_SMTP_SECURITY", "ssl")
    m = mailer_from_env()
    assert isinstance(m, SmtpMailer) and m.port == 465


def test_smtp_mailer_uses_starttls_and_password_file(tmp_path, monkeypatch):
    calls = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            calls.append(("connect", host, port))

        def __enter__(self):
            return self

        def __exit__(self, *a):
            calls.append(("quit",))

        def starttls(self, context):
            calls.append(("starttls",))

        def login(self, user, password):
            calls.append(("login", user, password))

        def send_message(self, msg):
            calls.append(("send", msg["To"], msg["Subject"]))

    secret = tmp_path / "smtp_parola"
    secret.write_text("cok-gizli\n")
    for k, v in {"VAKIFNAME_MAIL_BACKEND": "smtp", "VAKIFNAME_SMTP_HOST": "smtp.example.com",
                 "VAKIFNAME_MAIL_FROM": "VAKIFNAME <noreply@example.com>", "VAKIFNAME_SMTP_USER": "noreply@example.com",
                 "VAKIFNAME_SMTP_PASSWORD_FILE": str(secret)}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(mailer_mod.smtplib, "SMTP", FakeSMTP)
    mailer_from_env().send("ayse@example.com", *mailer_mod.reset_mail(BASE, "a" * 43, 30))
    assert calls == [("connect", "smtp.example.com", 587), ("starttls",), ("login", "noreply@example.com", "cok-gizli"),
                     ("send", "ayse@example.com", "VAKIFNAME: parola yenileme"), ("quit",)]
