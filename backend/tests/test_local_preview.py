"""R6.15.2: yayın izni bekleyen envanter fotoğrafları yalnızca yerel önizlemede sunulur (app/local_preview.py).

Kurgusal manifest ve dosyalar geçici klasörde. Kilitler: değişken tanımlı + loopback istemci + vekil başlığı yok. Biri
eksikse 404 (fotoğrafların varlığı belli olmaz). Kaynak (yayın ve cilt) ile yayın izni ayrı alanlardır; fotoğraflar
yalnızca kendi eserinin listesinde görünür; katalog yanıtı değişmez.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from scripts.build_local_preview_photos import PUBLICATION

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
LOCAL = ("127.0.0.1", 50000)
A, B = "a" * 20, "b" * 20


@pytest.fixture
def preview_dir(tmp_path, monkeypatch):
    media = tmp_path / "media"
    media.mkdir()
    for stem in (A, B):
        for kind in ("lg", "sm"):
            (media / f"{stem}-{kind}.webp").write_bytes(b"RIFF....WEBP" + stem.encode() + kind.encode())
    manifest = {"schema": "vakifname.local_preview_photos/1", "publication": PUBLICATION, "images": [
        {"image_id": f"LP-{A}", "monument_id": "BUR-0001", "file": f"{A}-lg.webp", "card_file": f"{A}-sm.webp", "width": 1200,
         "height": 800, "source": {"publication": "Bursa Vakıf Eserleri Envanteri, Cilt I", "pdf_page": 36},
         "original_sha256": "0" * 64, "original_name": "x.jpeg", "archive_folder": "x", "photographer": None, "license": None},
        {"image_id": f"LP-{B}", "monument_id": "BUR-0013", "file": f"{B}-lg.webp", "card_file": f"{B}-sm.webp", "width": 900,
         "height": 600, "source": {"publication": "Bursa Vakıf Eserleri Envanteri, Cilt II", "pdf_page": 22},
         "original_sha256": "1" * 64, "original_name": "y.jpeg", "archive_folder": "y", "photographer": None, "license": None},
    ]}
    (tmp_path / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv("VAKIFNAME_LOCAL_PREVIEW_PHOTOS_DIR", str(tmp_path))
    return tmp_path


def client(addr=LOCAL):
    return TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False), client=addr)


def test_disabled_without_env_even_from_loopback(monkeypatch):
    monkeypatch.delenv("VAKIFNAME_LOCAL_PREVIEW_PHOTOS_DIR", raising=False)
    with client() as c:
        assert c.get("/monuments/BUR-0001/local-photos").status_code == 404
        assert c.get(f"/local-media/{A}-sm.webp").status_code == 404


def test_loopback_gets_only_own_monument_photos_with_source_and_separate_permission(preview_dir):
    with client() as c:
        body = c.get("/monuments/BUR-0001/local-photos").json()
        assert [i["image_id"] for i in body["images"]] == [f"LP-{A}"]  # BUR-0013 fotoğrafı karışmaz
        img = body["images"][0]
        assert img["source"] == "Bursa Vakıf Eserleri Envanteri, Cilt I"
        assert img["pdf_page"] == 36 and img["printed_pages"] is None  # basılı sayfa kayıtta yoksa uydurulmaz
        assert "license" not in img and "photographer" not in img and "original_name" not in img
        assert body["publication"]["public"] is False and body["publication"]["status"] == "izin_bekleniyor"
        assert c.get("/monuments/BUR-0019/local-photos").json()["images"] == []
        r = c.get(f"/local-media/{A}-sm.webp")
        assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
        assert r.headers["cache-control"].startswith("private")


def test_non_loopback_or_proxied_requests_get_404(preview_dir):
    with client(("203.0.113.7", 40000)) as c:
        assert c.get("/monuments/BUR-0001/local-photos").status_code == 404
        assert c.get(f"/local-media/{A}-lg.webp").status_code == 404
    with client() as c:  # canlı ortamda ters vekil arkasında loopback görünen istek
        for h in ({"X-Forwarded-For": "198.51.100.1"}, {"Forwarded": "for=198.51.100.1"}, {"X-Real-IP": "198.51.100.1"}):
            assert c.get("/monuments/BUR-0001/local-photos", headers=h).status_code == 404
            assert c.get(f"/local-media/{A}-lg.webp", headers=h).status_code == 404


def test_media_names_are_strict_no_traversal(preview_dir):
    (preview_dir / "secret.txt").write_text("gizli", encoding="utf-8")
    with client() as c:
        for bad in ("..%2Fmanifest.json", "manifest.json", "..%2Fsecret.txt", f"{A}-lg.jpeg", f"{A.upper()}-lg.webp"):
            assert c.get(f"/local-media/{bad}").status_code in (404, 422)


def test_only_files_listed_in_manifest_are_served(preview_dir):
    # Seçkiden çıkarılan fotoğrafın kopyası klasörde kalsa da sunulmaz (R6.15.3).
    stale = "c" * 20
    (preview_dir / "media" / f"{stale}-lg.webp").write_bytes(b"RIFF....WEBPstale")
    with client() as c:
        assert c.get(f"/local-media/{stale}-lg.webp").status_code == 404
        assert c.get(f"/local-media/{A}-lg.webp").status_code == 200


def test_public_manifest_or_wrong_schema_is_refused(preview_dir):
    m = json.loads((preview_dir / "manifest.json").read_text(encoding="utf-8"))
    m["publication"] = {**m["publication"], "public": True}
    (preview_dir / "manifest.json").write_text(json.dumps(m), encoding="utf-8")
    with client() as c:
        assert c.get("/monuments/BUR-0001/local-photos").status_code == 404


def test_catalog_detail_unchanged_by_local_photos(preview_dir, monkeypatch):
    with client() as c:
        with_preview = c.get("/monuments/BUR-0001").json()
    monkeypatch.delenv("VAKIFNAME_LOCAL_PREVIEW_PHOTOS_DIR")
    with client() as c:
        assert c.get("/monuments/BUR-0001").json() == with_preview
        assert len(with_preview["images"]) == 6
