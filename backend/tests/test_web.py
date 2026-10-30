"""Genel arayüzün production sunucusu (`app.web`): yalnızca derleme çıktısı, güvenlik başlıkları, video Range."""

import pytest
from fastapi.testclient import TestClient

from app.web import content_security_policy, create_web_app

API = "https://api.example.org"


@pytest.fixture
def dist(tmp_path):
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "media").mkdir()
    (d / "index.html").write_text("<!doctype html><title>VAKIFNAME</title>", encoding="utf-8")
    (d / "assets" / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (d / "media" / "hero.mp4").write_bytes(b"\0\0\0\x20ftypisom" + bytes(range(256)) * 4)
    (tmp_path / "gizli.txt").write_text("dist dışı", encoding="utf-8")
    return d


def test_serves_build_with_security_headers_and_cache_rules(dist):
    with TestClient(create_web_app(dist, API)) as c:
        r = c.get("/")
        assert r.status_code == 200 and "VAKIFNAME" in r.text and r.headers["cache-control"] == "no-cache"
        csp = r.headers["content-security-policy"]
        assert "script-src 'self' https://accounts.google.com/gsi/client" in csp and "frame-ancestors 'none'" in csp
        assert f"connect-src 'self' {API} https://accounts.google.com/gsi/" in csp and "frame-src https://accounts.google.com/gsi/" in csp
        # Eser fotoğrafları yalnızca genel API kökeninden yüklenebilir.
        assert f"img-src 'self' data: https://tile.openstreetmap.org {API}" in csp
        assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"
        a = c.get("/assets/index-abc123.js")
        assert a.status_code == 200 and "immutable" in a.headers["cache-control"]
        # Sorgu parametreleri (ör. eski ?mod=demo) aynı genel sayfayı verir; demo veya envanter yoktur.
        assert c.get("/?mod=demo").text == r.text and c.get("/?mod=envanter").text == r.text


def test_video_supports_range(dist):
    with TestClient(create_web_app(dist, API)) as c:
        full = c.get("/media/hero.mp4")
        assert full.status_code == 200 and full.headers["content-type"] == "video/mp4"
        part = c.get("/media/hero.mp4", headers={"Range": "bytes=0-11"})
        assert part.status_code == 206 and part.content == b"\0\0\0\x20ftypisom"
        assert part.headers["content-range"].startswith("bytes 0-11/")


@pytest.mark.parametrize("path", ["/../gizli.txt", "/%2e%2e/gizli.txt", "/assets/../../gizli.txt", "/internal/status",
                                  "/monuments", "/media/", "/olmayan-sayfa"])
def test_nothing_outside_dist_and_no_api_proxy(dist, path):
    with TestClient(create_web_app(dist, API)) as c:
        r = c.get(path)
        assert r.status_code == 404 and "dist dışı" not in r.text


def test_rejects_api_origin_with_path_and_missing_build(tmp_path, dist):
    with pytest.raises(ValueError):
        create_web_app(dist, "https://api.example.org/v1")
    with pytest.raises(FileNotFoundError):
        create_web_app(tmp_path / "yok", API)
    assert "connect-src 'self' http://127.0.0.1:8001" in content_security_policy("http://127.0.0.1:8001")


@pytest.mark.parametrize("path", ["/giris", "/sehir", "/rota/bursa", "/eserler", "/eser/BUR-0001", "/eser/BUR-0001/rozet",
                                  "/pasaport", "/hesap", "/yonetim", "/yonetim/icerik", "/yonetim/icerik/eser/BUR-5001",
                                  "/yonetim/icerik/eser/yeni", "/yonetim/icerik/eser/BUR-0001/yeni-kayit",
                                  "/yonetim/icerik/kayit/BUR-0001-F501", "/yonetim/icerik/ceviri/BUR-0001-F001", "/dogrula", "/sifre-yenile"])
def test_app_routes_open_directly(dist, path):
    # Sayfa adres çubuğundan açılınca ya da yenilenince uygulama yüklenir.
    with TestClient(create_web_app(dist, API)) as c:
        r = c.get(path)
        assert r.status_code == 200 and "VAKIFNAME" in r.text and r.headers["cache-control"] == "no-cache"
        assert "content-security-policy" in r.headers
