"""Genel `/monuments` API'si: boş katalog, şema kuralları, nullable koordinat ve demo uçlarından ayrım."""

import json
import os

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import DEFAULT_CORS_ORIGINS, create_app
from app.public_catalog import PublicCatalog, PublicCatalogRepository
from tests.conftest import TEST_PLACES_FILE

DEC = "DEC-" + "a" * 16


def fact(fid="BUR-9001-F001", **kw):
    return {"fact_id": fid, "title": "Kurgusal", "text": "KURGUSAL OLGU", "category": "construction",
            "certainty": "documented", "source": {"title": "Kaynak", "pdf_physical_page": 3},
            "editorial_decision_id": DEC, "publication_decision_id": DEC, "game_use": False, **kw}


def monument(mid="BUR-9001", **kw):
    return {"monument_id": mid, "name": "Kurgusal Eser", "type": "cami", "city": "Test", "district": "Test",
            "address": "Test Caddesi", "catalog_decision_id": DEC, **kw}


def catalog(*monuments):
    return {"schema": "vakifname.public_catalog/1", "data_version": "V20:test", "monuments": list(monuments)}


LOCATION = {"latitude": 40.18, "longitude": 29.06, "accuracy_m": 20, "represents": "building_footprint_centroid",
            "verification_decision_id": DEC, "map_decision_id": DEC}
CHECKIN = {"latitude": 40.1801, "longitude": 29.0601, "radius_m": 40, "point_kind": "public_square",
           "access_hours_note": "Her gün", "safety_note": "Yaya alanı", "decision_id": DEC}


@pytest.fixture
def public(tmp_path):
    def make(doc):
        path = tmp_path / "catalog.json"
        path.write_text(json.dumps(doc), encoding="utf-8")
        # Bu dosya gerçek eser uçlarının demo uçlarından ayrı kaldığını da sınar; demo bu yüzden açıkça açılır.
        return TestClient(create_app(TEST_PLACES_FILE, cors_origins=DEFAULT_CORS_ORIGINS, public_catalog_file=path,
                                     demo_api=True))
    return make


def test_missing_snapshot_means_empty_catalog(tmp_path):
    with TestClient(create_app(TEST_PLACES_FILE, cors_origins=DEFAULT_CORS_ORIGINS,
                               public_catalog_file=tmp_path / "yok.json")) as c:
        body = c.get("/monuments").json()
        assert body["published_count"] == 0 and body["monuments"] == []
        assert c.get("/monuments/BUR-0001").status_code == 404


@pytest.mark.parametrize("bad", [
    monument(facts=[fact(editorial_decision_id=None)]),
    monument(facts=[fact(game_use=True)]),
    monument(facts=[fact(fid="BUR-9002-F001")]),
    monument(checkin=CHECKIN),
    monument(location={**LOCATION, "latitude": 0, "longitude": 0}),
    monument(location={k: v for k, v in LOCATION.items() if k != "map_decision_id"}),
    monument(drafts=[{"draft_id": "DRAFT-BUR-9001-001"}]),
    monument(monument_id="demo-mekan-a"),
])
def test_snapshot_schema_rejects_unapproved_or_inconsistent_records(bad):
    with pytest.raises(ValidationError):
        PublicCatalog.model_validate(catalog(bad))


def test_invalid_snapshot_fails_closed(tmp_path):
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(catalog(monument(checkin=CHECKIN))), encoding="utf-8")
    with pytest.raises(ValidationError):
        PublicCatalogRepository(path)


def test_monument_without_location_has_null_coordinates(public):
    with public(catalog(monument(facts=[fact()]))) as c:
        (m,) = c.get("/monuments").json()["monuments"]
        assert m["location"] is None and m["checkin_available"] is False and m["fact_count"] == 1
        d = c.get("/monuments/BUR-9001").json()
        assert d["location"] is None and d["checkin"] is None and d["illustration"] == "representative_drawing"


def test_legacy_checkin_endpoint_is_gone(public):
    # Ziyaret mührü yalnızca oyundaki `/visit` ile (bilgi mühründen sonra) verilir; eski uç kaldırıldı (29 Ekim).
    with public(catalog(monument(location=LOCATION, checkin=CHECKIN))) as c:
        detail = c.get("/monuments/BUR-9001").json()
        assert detail["checkin_available"] is True and "latitude" not in detail["checkin"]
        r = c.post("/monuments/BUR-9001/check-in", json={"user_id": "u", "latitude": 40.1801, "longitude": 29.0601})
        assert r.status_code in (404, 405)
        assert c.get("/users/u/monument-passport").json()["total_stamps"] == 0


def test_demo_endpoints_unchanged(public):
    with public(catalog(monument(location=LOCATION, checkin=CHECKIN))) as c:
        places = c.get("/places").json()
        assert places and all(p["is_demo"] for p in places)
        assert c.get("/places/BUR-9001").status_code == 404
        assert c.post("/quests/BUR-9001/check-in", json={"user_id": "u", "latitude": 40.18,
                                                         "longitude": 29.06}).status_code == 404


def test_media_served_only_when_listed(public, tmp_path):
    sha = "b" * 64
    image = {"image_id": "BUR-9001/x.jpeg", "file": f"{sha}.jpeg", "rights_holder": "Test", "license": "CC0-1.0",
             "rights_decision_id": DEC, "publication_decision_id": DEC, "game_use": False}
    (tmp_path / "media").mkdir()
    (tmp_path / "media" / f"{sha}.jpeg").write_bytes(b"\xff\xd8test")
    (tmp_path / "media" / f"{'c' * 64}.jpeg").write_bytes(b"\xff\xd8gizli")
    with public(catalog(monument(images=[image]))) as c:
        assert c.get(f"/monuments/media/{sha}.jpeg").status_code == 200
        assert c.get(f"/monuments/media/{'c' * 64}.jpeg").status_code == 404
        assert c.get("/monuments/media/..%2Fcatalog.json").status_code in (404, 422)


def test_demo_api_is_off_by_default(tmp_path, monkeypatch):
    """Genel platform varsayılan olarak yalnızca gerçek eser uçlarını sunar; kurgusal demo uçları kapalıdır."""
    monkeypatch.delenv("VAKIFNAME_DEMO_API", raising=False)
    with TestClient(create_app(TEST_PLACES_FILE, cors_origins=DEFAULT_CORS_ORIGINS,
                               public_catalog_file=tmp_path / "yok.json")) as c:
        assert c.get("/monuments").status_code == 200
        for path in ("/places", "/places/demo-a", "/users/u/passport"):
            assert c.get(path).status_code == 404, path
        assert c.post("/quests/demo-a/check-in", json={"user_id": "u", "latitude": 40, "longitude": 29}).status_code == 404
        assert "/places" not in c.get("/openapi.json").text
    monkeypatch.setenv("VAKIFNAME_DEMO_API", "on")
    with TestClient(create_app(TEST_PLACES_FILE, public_catalog_file=tmp_path / "yok.json")) as c:
        assert c.get("/places").status_code == 200


def _replace(path, doc):
    # Dışa aktarıcı gibi atomik değiştirme; yeni dosya yeni bir inode'dur.
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc) if isinstance(doc, dict) else doc, encoding="utf-8")
    os.replace(tmp, path)


def test_new_snapshot_is_served_without_restart_and_bad_snapshot_is_rejected(tmp_path):
    path = tmp_path / "catalog.json"
    _replace(path, catalog())
    with TestClient(create_app(TEST_PLACES_FILE, cors_origins=DEFAULT_CORS_ORIGINS, public_catalog_file=path)) as c:
        assert c.get("/monuments").json()["published_count"] == 0
        # Yeni yayın: aynı süreç, yeniden başlatma yok.
        _replace(path, catalog(monument()))
        assert [m["monument_id"] for m in c.get("/monuments").json()["monuments"]] == ["BUR-9001"]
        assert c.get("/monuments/BUR-9001").status_code == 200
        # Bozuk veya kuralları çiğneyen dosya: reddedilir, son geçerli katalog sunulmaya devam eder.
        _replace(path, "{yarım json")
        assert c.get("/monuments").json()["published_count"] == 1
        _replace(path, catalog(monument(checkin=CHECKIN)))
        assert c.get("/monuments/BUR-9001").json()["checkin_available"] is False
        # Dosya kaldırılırsa yayından kalkar.
        path.unlink()
        assert c.get("/monuments").json()["published_count"] == 0
        assert c.get("/monuments/BUR-9001").status_code == 404


def archive_image(mid="BUR-9001", n=1, **kw):
    return {"image_id": f"zip/{mid}/{n}.jpeg", "monument_id": mid, "file": f"{str(n) * 64}.jpg", "width": 640,
            "height": 400, "archive_folder": "Kurgusal Eser", "identity": "celiski_yok", **kw}


def archive(*images):
    return {"schema": "vakifname.archive_collection/1", "collection_id": "test", "source_label": "Proje arşivi",
            "note": "Arşivdeki sınıflandırma", "images": list(images)}


def test_archive_collection_is_shown_beside_approved_images_without_rights_fields(public, tmp_path):
    conflict = archive_image(n=2, identity="belgelenmis_celiski", identity_note="Kitapta başka yapının bölümünde.")
    _replace(tmp_path / "archive_collection.json", archive(archive_image(), conflict, archive_image("BUR-9002", 3)))
    (tmp_path / "media").mkdir()
    for n in (1, 2, 3):
        (tmp_path / "media" / f"{str(n) * 64}.jpg").write_bytes(b"\xff\xd8test")
    with public(catalog(monument(facts=[fact()]))) as c:
        body = c.get("/monuments/BUR-9001").json()
        coll = body["archive_collection"]
        assert coll["source_label"] == "Proje arşivi" and body["images"] == []
        assert [i["identity"] for i in coll["images"]] == ["celiski_yok", "belgelenmis_celiski"]
        assert coll["images"][1]["identity_note"]
        assert not {"license", "rights_holder", "monument_id"} & set(coll["images"][0])
        assert c.get(f"/monuments/media/{'1' * 64}.jpg").status_code == 200
        # Yayımlanmamış esere bağlı arşiv fotoğrafı sunulmaz.
        assert c.get(f"/monuments/media/{'3' * 64}.jpg").status_code == 404
        # Koleksiyon kaldırılınca yalnızca o kalkar; katalog aynen sunulur.
        (tmp_path / "archive_collection.json").unlink()
        body = c.get("/monuments/BUR-9001").json()
        assert body["archive_collection"] is None and len(body["facts"]) == 1
        assert c.get(f"/monuments/media/{'1' * 64}.jpg").status_code == 404


def test_archive_conflict_without_note_is_rejected():
    from app.public_catalog import ArchiveCollection
    with pytest.raises(ValidationError):
        ArchiveCollection.model_validate(archive(archive_image(identity="belgelenmis_celiski")))
    with pytest.raises(ValidationError):
        ArchiveCollection.model_validate(archive(archive_image(license="CC0-1.0")))
