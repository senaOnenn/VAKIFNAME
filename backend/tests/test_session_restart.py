"""R6.9: oturum backend yeniden başlatıldıktan sonra da geçerlidir.

Oturum belirteci tarayıcıdaki HttpOnly çerezde, özeti (SHA-256) hesap veritabanındaki `sessions` tablosundadır; her
açılışta yeniden üretilen bir imzalama sırrı yoktur. Hesap veritabanı dosyadaysa (`VAKIFNAME_ACCOUNTS_DB`) aynı çerez
yeni süreçte de aynı kullanıcıyı döndürür. Bellek içi depoda (yol verilmemiş) oturum doğal olarak kaybolur; açılış bunu
uyarır (test_player.py).
"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.auth_routes import SESSION_COOKIE
from app.main import create_app

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
PASSWORD = "Gizli-Parola-42"


def app(tmp_path):
    return create_app(public_catalog_file=SNAPSHOT, demo_api=False,
                      accounts_db=tmp_path / "accounts.sqlite3", progress_db=tmp_path / "progress.sqlite3")


def test_login_survives_a_backend_restart(tmp_path):
    with TestClient(app(tmp_path)) as first:
        r = first.post("/auth/register", json={"email": "kalici-oturum@example.com", "password": PASSWORD})
        assert r.status_code == 201
        uid = r.json()["user_id"]
        first.put("/player/character", json={"character_id": "katip"})
        token = first.cookies.get(SESSION_COOKIE)
        assert token
    # "Yeniden başlatma": aynı dosyalarla yeni uygulama; tarayıcı aynı çerezi gönderir, yeniden giriş yapılmaz.
    with TestClient(app(tmp_path)) as second:
        second.cookies.set(SESSION_COOKIE, token)
        me = second.get("/auth/me")
        assert me.status_code == 200 and me.json()["user_id"] == uid
        profile = second.get("/player/profile")
        assert profile.status_code == 200 and profile.json()["character"]["id"] == "katip"
        assert second.get("/route", params={"city": "bursa", "user_id": uid}).status_code == 200


def test_logout_still_ends_the_session_across_restarts(tmp_path):
    with TestClient(app(tmp_path)) as first:
        first.post("/auth/register", json={"email": "cikis@example.com", "password": PASSWORD})
        token = first.cookies.get(SESSION_COOKIE)
        assert first.post("/auth/logout").status_code in (200, 204)
    with TestClient(app(tmp_path)) as second:
        second.cookies.set(SESSION_COOKIE, token)
        assert second.get("/auth/me").status_code == 401
