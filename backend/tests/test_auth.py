"""Hesap sistemi: kayıt/giriş/çıkış, oturum çerezi ve süresi, Google ile giriş (sahte doğrulayıcı ve yerel anahtarlarla
gerçek doğrulayıcı; ağa çıkılmaz), misafir ilerlemesinin hesaba taşınması, hesap silme (KVKK), hesap ilerlemesinin
korunması, oran sınırı ve sıkı girdi doğrulaması."""

import hashlib
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm
from jwt.exceptions import PyJWKClientConnectionError

from app.accounts import AccountStore, hash_password, verify_password
from app.auth_routes import LOGIN_FAILED, SESSION_COOKIE
from app.google_auth import GoogleIdentity, GoogleUnavailable, GoogleVerifier, InvalidGoogleToken
from app.main import create_app
from app.progress import MonumentProgressStore

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
CATALOG = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
PASSWORD = "Gizli-Parola-42"
THIRTY_DAYS = 30 * 24 * 3600


def visitor() -> str:
    return f"ziyaretci-{uuid.uuid4()}"


def answers(monument_id: str) -> list[tuple[str, int]]:
    """Eserin keşif soruları ve doğru şıkları (yalnızca testte, anlık görüntüden okunur)."""
    (m,) = [m for m in CATALOG["monuments"] if m["monument_id"] == monument_id]
    return [(f["fact_id"], f["quest"]["answer_index"]) for f in m["facts"] if f.get("quest")]


def unlock(c, user_id: str, monument_id: str):
    """Eseri kullanıcının rotasında açılmış say: soru cevaplama rota kilidine uyar; bu dosyadaki testler kilitle değil,
    hesap erişimi ve birleştirmeyle ilgilidir (kilit testleri: test_route.py, test_game.py)."""
    c.app.state.monument_progress.plan_unlocks(user_id, lambda done, unlocked: (None, [monument_id]))


def earn_knowledge_seal(c, user_id: str, monument_id: str):
    unlock(c, user_id, monument_id)
    for quest_id, idx in answers(monument_id):
        r = c.post(f"/monuments/{monument_id}/quests/{quest_id}/answer", json={"user_id": user_id, "choice_index": idx})
        assert r.status_code == 200, r.text
    assert r.json()["knowledge_seal"] is not None


def set_cookie_attrs(response) -> dict:
    (header,) = [v for k, v in response.headers.multi_items() if k == "set-cookie"]
    morsel = SimpleCookie(header)[SESSION_COOKIE]
    return {"value": morsel.value, "header": header.lower(), "max-age": morsel["max-age"], "path": morsel["path"],
            "samesite": morsel["samesite"].lower(), "httponly": bool(morsel["httponly"]), "secure": bool(morsel["secure"])}


class FakeGoogle:
    """Ağa çıkmayan sahte doğrulayıcı: bilinen belirteçleri kimliğe çevirir, diğerlerini reddeder."""

    def __init__(self, tokens: dict[str, GoogleIdentity]):
        self.tokens = tokens

    def verify(self, id_token: str) -> GoogleIdentity:
        if id_token not in self.tokens:
            raise InvalidGoogleToken("unknown")
        return self.tokens[id_token]


@pytest.fixture(autouse=True)
def clean_auth_env(monkeypatch):
    for name in ("VAKIFNAME_GOOGLE_CLIENT_ID", "VAKIFNAME_COOKIE_SECURE", "VAKIFNAME_ACCOUNTS_DB", "VAKIFNAME_AUTH_RATE",
                 "VAKIFNAME_PROGRESS_DB"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def c():
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False)) as client:
        yield client


def register(c, email="ayse@example.com", password=PASSWORD, **extra):
    return c.post("/auth/register", json={"email": email, "password": password, **extra})


# --- Kayıt, giriş, çıkış -----------------------------------------------------------------------------------------

def test_register_login_me_logout_happy_path(c):
    r = register(c, email="  Ayse@Example.COM ", display_name="  Ayşe   Yılmaz ")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["email"] == "ayse@example.com" and body["display_name"] == "Ayşe Yılmaz" and body["provider"] == "password"
    assert body["user_id"].startswith("u-") and len(body["user_id"]) == 38
    assert r.headers["cache-control"] == "no-store"
    assert c.get("/auth/me").json() == body

    assert c.post("/auth/logout").status_code == 204
    assert c.get("/auth/me").status_code == 401

    r = c.post("/auth/login", json={"email": "AYSE@example.com", "password": PASSWORD})
    assert r.status_code == 200 and r.json() == body
    assert c.get("/auth/me").json()["user_id"] == body["user_id"]


def test_logout_revokes_the_session_on_the_server(c):
    token = set_cookie_attrs(register(c))["value"]
    assert c.post("/auth/logout").status_code == 204
    # Çerez tarayıcıda kalmış olsa bile (ör. kopyalanmış) sunucu oturumu artık tanımaz.
    c.cookies.set(SESSION_COOKIE, token)
    assert c.get("/auth/me").status_code == 401


def test_duplicate_email_is_rejected_with_409(c):
    assert register(c).status_code == 201
    r = register(c, email=" AYSE@example.com", password="Baska-Parola-1")
    assert r.status_code == 409 and r.json()["detail"] == "Bu e-posta adresiyle kayıtlı bir hesap zaten var."


def test_login_failure_is_generic_for_wrong_password_unknown_email_and_google_only(c):
    register(c)
    c.app.state.accounts.google_sign_in("google-sub-1", "google@example.com", "Google Kullanıcısı")
    c.post("/auth/logout")
    wrong = c.post("/auth/login", json={"email": "ayse@example.com", "password": "yanlis-parola"})
    unknown = c.post("/auth/login", json={"email": "kimse@example.com", "password": PASSWORD})
    google_only = c.post("/auth/login", json={"email": "google@example.com", "password": PASSWORD})
    for r in (wrong, unknown, google_only):
        assert r.status_code == 401
        assert r.content == wrong.content and r.json() == {"detail": LOGIN_FAILED}
        assert "set-cookie" not in r.headers


def test_password_is_hashed_never_stored_or_echoed(c):
    r = register(c, display_name="Ayşe")
    user_id = r.json()["user_id"]
    row = c.app.state.accounts._db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    assert row["password_hash"].startswith("scrypt$16384$8$1$") and PASSWORD not in row["password_hash"]
    dump = "\n".join(str(tuple(r)) for r in c.app.state.accounts._db.execute("SELECT * FROM users, sessions"))
    assert PASSWORD not in dump
    responses = [r, c.get("/auth/me"), c.post("/auth/login", json={"email": "ayse@example.com", "password": PASSWORD})]
    assert all(PASSWORD not in x.text for x in responses)
    # Doğrulama hatasında da parola (veya başka girdi) yanıtta geri yazılmaz.
    short = c.post("/auth/register", json={"email": "b@example.com", "password": "Kisa-7!"})
    long_ = c.post("/auth/login", json={"email": "b@example.com", "password": "P" * 129})
    assert short.status_code == long_.status_code == 422
    assert "Kisa-7!" not in short.text and "P" * 129 not in long_.text and '"input"' not in short.text


def test_password_hash_format_and_unicode_normalization():
    encoded = hash_password("şifre-ŞİFRE-1")
    algo, n, r, p, salt, dk = encoded.split("$")
    assert (algo, n, r, p) == ("scrypt", "16384", "8", "1")
    assert hash_password("şifre-ŞİFRE-1") != encoded  # her özet kendi rastgele tuzuyla
    assert verify_password("şifre-ŞİFRE-1", encoded) and not verify_password("sifre-SIFRE-1", encoded)
    # "ş" tek karakter (U+015F) ya da "s" + birleşen çengel (U+0327) olarak gelse de aynı parola sayılır.
    assert verify_password("şifre-ŞİFRE-1", encoded)
    # Özet parametreleri taşır: farklı parametrelerle üretilmiş eski özet de doğrulanır.
    assert verify_password("eski", hash_password("eski", n=2**12, r=8, p=1))
    assert not verify_password("x", "bozuk$özet") and not verify_password("x", "bcrypt$1$2$3$4$5")


# --- Oturum çerezi ve süresi -------------------------------------------------------------------------------------

def test_session_cookie_flags_and_only_its_hash_is_stored(c):
    r = register(c)
    attrs = set_cookie_attrs(r)
    assert attrs["httponly"] and attrs["samesite"] == "lax" and attrs["path"] == "/"
    assert attrs["max-age"] == str(THIRTY_DAYS) and not attrs["secure"]  # http isteği, VAKIFNAME_COOKIE_SECURE yok
    token = attrs["value"]
    assert len(token) >= 43
    rows = c.app.state.accounts._db.execute("SELECT * FROM sessions").fetchall()
    assert [x["token_sha256"] for x in rows] == [hashlib.sha256(token.encode()).hexdigest()]
    assert token not in str([tuple(x) for x in rows])
    created, expires = (datetime.fromisoformat(rows[0][k]) for k in ("created_at", "expires_at"))
    assert expires - created == timedelta(days=30)


@pytest.mark.parametrize("env, base_url, secure", [
    (None, "https://testserver", True),   # otomatik: HTTPS isteğinde Secure
    ("1", "http://testserver", True),     # TLS vekilde sonlanıyor
    ("0", "https://testserver", False),
])
def test_cookie_secure_flag_follows_env_or_scheme(monkeypatch, env, base_url, secure):
    if env is not None:
        monkeypatch.setenv("VAKIFNAME_COOKIE_SECURE", env)
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False), base_url=base_url) as client:
        assert set_cookie_attrs(register(client))["secure"] is secure


def test_expired_session_is_rejected_and_removed(c):
    register(c)
    store: AccountStore = c.app.state.accounts
    store.clock = lambda: datetime.now(timezone.utc) + timedelta(days=29)
    assert c.get("/auth/me").status_code == 200
    store.clock = lambda: datetime.now(timezone.utc) + timedelta(days=30, minutes=1)
    assert c.get("/auth/me").status_code == 401
    assert store._db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


def test_garbage_or_oversized_cookie_is_simply_unauthenticated(c):
    for value in ("yok", "x" * 500):
        c.cookies.set(SESSION_COOKIE, value)
        assert c.get("/auth/me").status_code == 401


# --- Google ile giriş --------------------------------------------------------------------------------------------

def test_google_is_503_when_not_configured(c):
    assert c.app.state.google_verifier is None
    r = c.post("/auth/google", json={"id_token": "x" * 40})
    assert r.status_code == 503 and r.json()["detail"] == "Google ile giriş yapılandırılmadı."


def test_google_verifier_is_built_from_env(monkeypatch):
    monkeypatch.setenv("VAKIFNAME_GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com")
    app = create_app(public_catalog_file=SNAPSHOT, demo_api=False)
    assert isinstance(app.state.google_verifier, GoogleVerifier)
    assert app.state.google_verifier.client_id == "test-client.apps.googleusercontent.com"


def test_google_creates_new_user_then_finds_it_by_sub(c):
    c.app.state.google_verifier = FakeGoogle({"sahte-belirtec-1": GoogleIdentity("sub-1", "Mehmet@Gmail.com", "Mehmet")})
    r = c.post("/auth/google", json={"id_token": "sahte-belirtec-1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "mehmet@gmail.com" and body["display_name"] == "Mehmet" and body["provider"] == "google"
    assert set_cookie_attrs(r)["httponly"]
    assert c.get("/auth/me").json() == body
    c.post("/auth/logout")
    assert c.post("/auth/google", json={"id_token": "sahte-belirtec-1"}).json()["user_id"] == body["user_id"]
    # Google hesabının parolası yoktur: e-posta ile parola girişi genel 401 alır.
    assert c.post("/auth/login", json={"email": "mehmet@gmail.com", "password": PASSWORD}).status_code == 401


def test_google_links_to_existing_account_with_same_email(c):
    user_id = register(c, email="ayse@example.com").json()["user_id"]
    c.post("/auth/logout")
    c.app.state.google_verifier = FakeGoogle({"sahte-belirtec-a": GoogleIdentity("sub-a", "AYSE@example.com", "Ayşe G.")})
    r = c.post("/auth/google", json={"id_token": "sahte-belirtec-a"})
    assert r.status_code == 200 and r.json()["user_id"] == user_id and r.json()["provider"] == "google"
    assert c.app.state.accounts.get_user(user_id)["google_sub"] == "sub-a"


def test_google_link_drops_unverified_password_and_its_sessions(c):
    """Önceden hesap ele geçirme: e-postayı doğrulamadan parolayla kaydeden kişi, gerçek sahip Google ile bağlanınca
    hem parolasını hem açık oturumunu kaybeder."""
    attacker = TestClient(c.app)
    user_id = register(attacker, email="kurban@example.com").json()["user_id"]
    assert attacker.get("/auth/me").status_code == 200
    c.app.state.google_verifier = FakeGoogle({"sahte-belirtec-k": GoogleIdentity("sub-k", "kurban@example.com")})
    assert c.post("/auth/google", json={"id_token": "sahte-belirtec-k"}).json()["user_id"] == user_id
    assert attacker.get("/auth/me").status_code == 401
    assert c.app.state.accounts.get_user(user_id)["password_hash"] is None
    r = attacker.post("/auth/login", json={"email": "kurban@example.com", "password": PASSWORD})
    assert r.status_code == 401 and r.json()["detail"] == LOGIN_FAILED
    # Gerçek sahibin Google oturumu sürer.
    assert c.get("/auth/me").json()["user_id"] == user_id


def test_google_email_already_linked_to_another_google_account_is_409(c):
    c.app.state.google_verifier = FakeGoogle({"sahte-belirtec-1": GoogleIdentity("sub-1", "ortak@example.com"),
                                              "sahte-belirtec-2": GoogleIdentity("sub-2", "ortak@example.com")})
    assert c.post("/auth/google", json={"id_token": "sahte-belirtec-1"}).status_code == 200
    r = c.post("/auth/google", json={"id_token": "sahte-belirtec-2"})
    assert r.status_code == 409 and "set-cookie" not in r.headers


def test_google_invalid_token_is_401_and_unavailable_is_503(c):
    c.app.state.google_verifier = FakeGoogle({})
    r = c.post("/auth/google", json={"id_token": "gecersiz-belirtec"})
    assert r.status_code == 401 and r.json()["detail"] == "Google kimliği doğrulanamadı."

    class Down:
        def verify(self, id_token):
            raise GoogleUnavailable()

    c.app.state.google_verifier = Down()
    assert c.post("/auth/google", json={"id_token": "herhangi-belirtec"}).status_code == 503


# Gerçek doğrulayıcı: yerel RSA anahtarı ve ağa çıkmayan JWKS kümesiyle.

CLIENT_ID = "test-client.apps.googleusercontent.com"


@pytest.fixture(scope="module")
def rsa_keys():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048), \
        rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _verifier(public_key, kid="kid-1"):
    jwk = json.loads(RSAAlgorithm.to_jwk(public_key))
    client = jwt.PyJWKClient("https://example.invalid/certs")
    client.fetch_data = lambda: {"keys": [{**jwk, "kid": kid, "alg": "RS256", "use": "sig"}]}
    return GoogleVerifier(CLIENT_ID, jwks_client=client)


def _claims(**over):
    now = int(time.time())
    claims = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": "1234567890", "email": "Zeynep@Gmail.com",
              "email_verified": True, "name": "Zeynep\x07 Kaya", "iat": now, "exp": now + 600}
    claims.update(over)
    return {k: v for k, v in claims.items() if v is not None}


def _sign(private_key, claims, kid="kid-1", alg="RS256"):
    return jwt.encode(claims, private_key, algorithm=alg, headers={"kid": kid})


def test_real_verifier_accepts_valid_google_token(rsa_keys):
    key, _ = rsa_keys
    identity = _verifier(key.public_key()).verify(_sign(key, _claims()))
    assert identity == GoogleIdentity(sub="1234567890", email="zeynep@gmail.com", name="Zeynep Kaya")
    assert _verifier(key.public_key()).verify(_sign(key, _claims(iss="accounts.google.com"))).sub == "1234567890"


@pytest.mark.parametrize("claims", [
    _claims(aud="baska-istemci.apps.googleusercontent.com"),
    _claims(iss="https://evil.example.com"),
    _claims(email_verified=False),
    _claims(email_verified=None),
    _claims(email=None),
    _claims(sub=None),
    _claims(exp=int(time.time()) - 3600),
])
def test_real_verifier_rejects_bad_claims(rsa_keys, claims):
    key, _ = rsa_keys
    with pytest.raises(InvalidGoogleToken):
        _verifier(key.public_key()).verify(_sign(key, claims))


def test_real_verifier_rejects_foreign_signature_unknown_kid_hs256_and_garbage(rsa_keys):
    key, other = rsa_keys
    v = _verifier(key.public_key())
    for token in (_sign(other, _claims()),                                   # başka anahtarla imzalı
                  _sign(key, _claims(), kid="bilinmeyen"),                   # bilinmeyen anahtar
                  jwt.encode(_claims(), "x" * 32, algorithm="HS256", headers={"kid": "kid-1"}),  # algoritma karışıklığı
                  "bu.bir.belirtecdegil", "x" * 40):
        with pytest.raises(InvalidGoogleToken):
            v.verify(token)


def test_real_verifier_reports_network_failure_as_unavailable(rsa_keys):
    key, _ = rsa_keys
    client = jwt.PyJWKClient("https://example.invalid/certs")

    def down():
        raise PyJWKClientConnectionError("ağ yok")

    client.fetch_data = down
    with pytest.raises(GoogleUnavailable):
        GoogleVerifier(CLIENT_ID, jwks_client=client).verify(_sign(key, _claims()))


def test_google_endpoint_with_real_verifier_end_to_end(c, rsa_keys):
    key, _ = rsa_keys
    c.app.state.google_verifier = _verifier(key.public_key())
    r = c.post("/auth/google", json={"id_token": _sign(key, _claims())})
    assert r.status_code == 200 and r.json()["email"] == "zeynep@gmail.com"
    assert c.post("/auth/google", json={"id_token": _sign(key, _claims(aud="baska"))}).status_code == 401


# --- Misafir ilerlemesinin hesaba taşınması ----------------------------------------------------------------------

def test_guest_progress_is_merged_on_register(c):
    guest = visitor()
    earn_knowledge_seal(c, guest, "BUR-0005")
    r = register(c, visitor_id=guest)
    user_id = r.json()["user_id"]
    seals = c.get(f"/users/{user_id}/seals").json()
    assert [s["monument_id"] for s in seals["knowledge_seals"]] == ["BUR-0005"]
    solved = {m["monument_id"]: m["solved"] for m in seals["monuments"]}
    assert solved["BUR-0005"] == len(answers("BUR-0005"))
    # Misafir satırları silinir: aynı ilerleme iki kimlikte birden görünmez.
    assert c.get(f"/users/{guest}/seals").json()["knowledge_seals"] == []


def test_guest_progress_is_merged_on_login_without_duplicates(c):
    user_id = register(c).json()["user_id"]
    earn_knowledge_seal(c, user_id, "BUR-0005")
    earned_before = c.get(f"/users/{user_id}/seals").json()["knowledge_seals"][0]["earned_at"]
    c.post("/auth/logout")

    guest = visitor()
    earn_knowledge_seal(c, guest, "BUR-0005")   # hesapta da var
    earn_knowledge_seal(c, guest, "BUR-0014")   # yalnızca misafirde
    r = c.post("/auth/login", json={"email": "ayse@example.com", "password": PASSWORD, "visitor_id": guest})
    assert r.status_code == 200
    seals = c.get(f"/users/{user_id}/seals").json()["knowledge_seals"]
    assert sorted(s["monument_id"] for s in seals) == ["BUR-0005", "BUR-0014"]
    assert next(s for s in seals if s["monument_id"] == "BUR-0005")["earned_at"] == earned_before  # hesabınki kalır
    db = c.app.state.monument_progress._db
    assert db.execute("SELECT COUNT(*) FROM seals WHERE user_id=?", (guest,)).fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM quest_answers WHERE user_id=?", (guest,)).fetchone()[0] == 0
    # İkinci girişte (aynı misafir kimliğiyle) hiçbir şey ikilenmez.
    c.post("/auth/login", json={"email": "ayse@example.com", "password": PASSWORD, "visitor_id": guest})
    assert len(c.get(f"/users/{user_id}/seals").json()["knowledge_seals"]) == 2


def test_guest_progress_is_merged_on_google_sign_in(c):
    guest = visitor()
    earn_knowledge_seal(c, guest, "BUR-0014")
    c.app.state.google_verifier = FakeGoogle({"sahte-belirtec": GoogleIdentity("sub-g", "g@example.com")})
    user_id = c.post("/auth/google", json={"id_token": "sahte-belirtec", "visitor_id": guest}).json()["user_id"]
    assert len(c.get(f"/users/{user_id}/seals").json()["knowledge_seals"]) == 1


def test_merge_user_keeps_account_rows_and_fills_unsolved_answers():
    s = MonumentProgressStore()
    s.record_answer("u-hesap", "BUR-0001", "BUR-0001-F001", correct=True)
    s.record_answer("u-hesap", "BUR-0001", "BUR-0001-F002", correct=False)
    s.add_seal("u-hesap", "BUR-0001", "Ulu Cami", "visit")
    s.record_answer("misafir", "BUR-0001", "BUR-0001-F001", correct=True)
    s.record_answer("misafir", "BUR-0001", "BUR-0001-F002", correct=True)
    s.record_answer("misafir", "BUR-0001", "BUR-0001-F003", correct=False)
    s.add_seal("misafir", "BUR-0001", "Ulu Cami", "visit")
    s.add_seal("misafir", "BUR-0001", "Ulu Cami", "knowledge")
    hesap_visit = s.seals("u-hesap")[0]["earned_at"]

    s.merge_user("misafir", "u-hesap")
    assert s.solved("u-hesap") == {"BUR-0001-F001", "BUR-0001-F002"}
    rows = {r["quest_id"]: dict(r) for r in s._db.execute("SELECT * FROM quest_answers WHERE user_id='u-hesap'")}
    assert set(rows) == {"BUR-0001-F001", "BUR-0001-F002", "BUR-0001-F003"}
    assert rows["BUR-0001-F002"]["attempts"] == 2 and rows["BUR-0001-F003"]["correct_at"] is None
    assert sorted(x["kind"] for x in s.seals("u-hesap")) == ["knowledge", "visit"]
    assert next(x for x in s.seals("u-hesap") if x["kind"] == "visit")["earned_at"] == hesap_visit
    assert s.seals("misafir") == [] and s.solved("misafir") == set()
    assert s.merge_user("u-hesap", "u-hesap") == {"answers": 0, "seals": 0, "unlocks": 0}


# --- Hesap silme (KVKK) ------------------------------------------------------------------------------------------

def test_delete_me_removes_account_sessions_and_progress(c):
    r = register(c, display_name="Silinecek", visitor_id=None)
    user_id, token = r.json()["user_id"], set_cookie_attrs(r)["value"]
    earn_knowledge_seal(c, user_id, "BUR-0005")
    other = TestClient(c.app)  # aynı hesabın ikinci cihazı
    other.post("/auth/login", json={"email": "ayse@example.com", "password": PASSWORD})

    d = c.delete("/auth/me")
    assert d.status_code == 204 and 'max-age=0' in d.headers["set-cookie"].lower()
    store = c.app.state.accounts
    assert store._db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
    row = dict(store._db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())
    assert row["deleted_at"] and all(row[k] is None for k in ("email", "password_hash", "google_sub", "display_name"))
    db = c.app.state.monument_progress._db
    assert db.execute("SELECT COUNT(*) FROM seals WHERE user_id=?", (user_id,)).fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM quest_answers WHERE user_id=?", (user_id,)).fetchone()[0] == 0

    assert other.get("/auth/me").status_code == 401
    c.cookies.set(SESSION_COOKIE, token)
    assert c.get("/auth/me").status_code == 401
    assert c.post("/auth/login", json={"email": "ayse@example.com", "password": PASSWORD}).status_code == 401
    # E-posta serbest kalır; yeni kayıt yeni bir kimlik alır.
    again = register(c)
    assert again.status_code == 201 and again.json()["user_id"] != user_id


def test_delete_me_requires_session(c):
    assert c.delete("/auth/me").status_code == 401


# --- Hesap ilerlemesinin korunması -------------------------------------------------------------------------------

def test_account_progress_requires_own_session(c):
    owner = register(c, email="sahip@example.com").json()["user_id"]
    stranger = TestClient(c.app)
    assert stranger.post("/auth/register", json={"email": "baska@example.com", "password": PASSWORD}).status_code == 201
    anonymous = TestClient(c.app)
    quest_id, idx = answers("BUR-0005")[0]
    unlock(c, owner, "BUR-0005")

    def calls(client):
        return [client.get(f"/users/{owner}/seals"),
                client.get(f"/users/{owner}/monument-passport"),
                client.get(f"/monuments/BUR-0005/quests?user_id={owner}"),
                client.post(f"/monuments/BUR-0005/quests/{quest_id}/answer", json={"user_id": owner, "choice_index": idx}),
                client.post("/monuments/BUR-0005/check-in", json={"user_id": owner, "latitude": 40.18, "longitude": 29.06})]

    assert [r.status_code for r in calls(anonymous)] == [401] * 5
    assert [r.status_code for r in calls(stranger)] == [403] * 5
    # Sahibi okur ve yazar (check-in bu eserde açık olmadığı için 409).
    assert [r.status_code for r in calls(c)] == [200, 200, 200, 200, 409]
    db = c.app.state.monument_progress._db
    assert db.execute("SELECT attempts FROM quest_answers WHERE user_id=?", (owner,)).fetchone()[0] == 1


def test_guest_ids_keep_working_without_session(c):
    guest = visitor()
    earn_knowledge_seal(c, guest, "BUR-0005")
    assert c.get(f"/users/{guest}/seals").status_code == 200
    assert c.get(f"/users/{guest}/monument-passport").status_code == 200
    assert c.get(f"/monuments/BUR-0005/quests?user_id={guest}").json()["progress"]["solved"] == len(answers("BUR-0005"))


# --- Oran sınırı ve sıkı doğrulama -------------------------------------------------------------------------------

def test_auth_posts_are_rate_limited_per_client(c):
    statuses = [c.post("/auth/login", json={"email": f"k{i}@example.com", "password": PASSWORD}).status_code
                for i in range(10)]
    assert statuses == [401] * 10
    r = c.post("/auth/register", json={"email": "yeni@example.com", "password": PASSWORD})
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
    assert c.post("/auth/logout").status_code == 429


@pytest.mark.parametrize("path, body", [
    ("/auth/register", {"email": "a@example.com", "password": PASSWORD, "rol": "admin"}),
    ("/auth/register", {"email": "e-posta-degil", "password": PASSWORD}),
    ("/auth/register", {"email": "a b@example.com", "password": PASSWORD}),
    ("/auth/register", {"email": "a@" + "x" * 250 + ".com", "password": PASSWORD}),
    ("/auth/register", {"email": "a@example.com", "password": "1234567"}),
    ("/auth/register", {"email": "a@example.com", "password": "x" * 129}),
    ("/auth/register", {"email": "a@example.com", "password": PASSWORD, "display_name": "x" * 61}),
    ("/auth/register", {"email": "a@example.com", "password": PASSWORD, "display_name": "Ad\x00"}),
    ("/auth/register", {"email": "a@example.com", "password": PASSWORD, "visitor_id": "u-" + str(uuid.uuid4())}),
    ("/auth/register", {"email": "a@example.com", "password": PASSWORD,
                        "visitor_id": "ziyaretci-" + str(uuid.uuid4()).upper()}),
    ("/auth/register", {"email": "a@example.com"}),
    ("/auth/login", {"email": "a@example.com", "password": ""}),
    ("/auth/login", {"email": "a@example.com", "password": PASSWORD, "visitor_id": "ziyaretci-kisa"}),
    ("/auth/google", {"id_token": "x" * 4097}),
    ("/auth/google", {"id_token": "x" * 40, "email": "a@example.com"}),
])
def test_strict_validation_rejects_bad_input(c, path, body):
    r = c.post(path, json=body)
    assert r.status_code == 422, r.text
    assert "set-cookie" not in r.headers


def test_form_encoded_login_is_not_accepted(c):
    register(c)
    c.post("/auth/logout")
    r = c.post("/auth/login", content='{"email":"ayse@example.com","password":"%s"}' % PASSWORD,
               headers={"content-type": "text/plain"})
    assert r.status_code == 422


def test_accounts_db_file_is_private_and_persistent(tmp_path):
    db = tmp_path / "hesap" / "accounts.sqlite3"
    store = AccountStore(db)
    user = store.create_user("kalici@example.com", PASSWORD)
    token = store.create_session(user["id"], "password")
    store.close()
    assert (db.stat().st_mode & 0o777) == 0o600
    store = AccountStore(db)
    assert store.session_user(token)["id"] == user["id"]
    assert store.authenticate("kalici@example.com", PASSWORD)["id"] == user["id"]
