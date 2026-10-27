"""Anonim istatistikler: kişisel veri diske yazılmaz; yönetici paneli yalnızca yöneticiye açıktır."""

from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.stats import StatsStore

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
PASSWORD = "gizli-parola-1"


@pytest.fixture
def c(monkeypatch):
    monkeypatch.setenv("VAKIFNAME_ADMIN_EMAILS", "Yonetici@Example.com")
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False)) as client:
        yield client


def test_unique_visitors_per_day_and_counters(tmp_path):
    day = [date(2026, 10, 27)]
    s = StatsStore(tmp_path / "s.sqlite3", today=lambda: day[0])
    s.record("eser", "BUR-0001", "1.2.3.4|ua")
    s.record("eser", "BUR-0001", "1.2.3.4|ua")
    s.record("rota", None, "5.6.7.8|ua")
    day[0] = date(2026, 10, 28)
    s.record("eser", "BUR-0009", "1.2.3.4|ua")  # yeni gün: aynı kişi yeniden sayılır, tuz yenilenir
    out = s.summary(days=2)
    assert out["days"] == [{"day": "2026-10-27", "visitors": 2, "pageviews": 3}, {"day": "2026-10-28", "visitors": 1, "pageviews": 1}]
    assert out["totals"] == {"visitors": 3, "pageviews": 4, "monument_views": 3}
    assert out["monuments"][0] == {"monument_id": "BUR-0001", "views": 2}
    assert out["pages"][0] == {"page": "eser", "views": 3}


def test_no_personal_data_reaches_disk(tmp_path):
    path = tmp_path / "s.sqlite3"
    s = StatsStore(path)
    s.record("eser", "BUR-0001", "203.0.113.77|Mozilla/5.0 Gizli Tarayici")
    s._db.close()
    raw = path.read_bytes()
    assert b"203.0.113.77" not in raw and b"Gizli" not in raw


def test_hit_validates_and_ignores_unknown_monuments(c):
    assert c.post("/stats/hit", json={"page": "eser", "monument_id": "BUR-0001"}).status_code == 204
    assert c.post("/stats/hit", json={"page": "eser", "monument_id": "BUR-0999"}).status_code == 204
    assert c.post("/stats/hit", json={"page": "bilinmeyen"}).status_code == 422
    assert c.post("/stats/hit", json={"page": "eser", "fazla": 1}).status_code == 422
    out = c.app.state.stats.summary(1)
    assert out["totals"]["pageviews"] == 2 and out["monuments"] == [{"monument_id": "BUR-0001", "views": 1}]


def test_hit_rate_limit_is_silent(c):
    for _ in range(130):
        assert c.post("/stats/hit", json={"page": "sehir"}).status_code == 204
    assert c.app.state.stats.summary(1)["totals"]["pageviews"] == 120


def test_admin_stats_requires_admin_session(c):
    assert c.get("/admin/stats").status_code == 401
    r = c.post("/auth/register", json={"email": "uye@example.com", "password": PASSWORD})
    assert r.json()["is_admin"] is False
    assert c.get("/admin/stats").status_code == 403
    c.post("/auth/logout")
    r = c.post("/auth/register", json={"email": "yonetici@example.com", "password": PASSWORD})
    assert r.json()["is_admin"] is True and c.get("/auth/me").json()["is_admin"] is True
    c.post("/stats/hit", json={"page": "eser", "monument_id": "BUR-0001"})
    body = c.get("/admin/stats?days=7").json()
    assert len(body["days"]) == 7 and body["monuments"][0]["name"] == "Bursa Ulu Camii"
    assert c.get("/admin/stats?days=0").status_code == 422
