"""Görev 30: hackathon ZIP fotoğraflarının ek katmanı, yazılı izin kuralı, kimlik çelişkisi ve dahili galeri (kurgusal)."""

import hashlib
import json

import pytest

from app.internal.catalog import CatalogError
from app.internal.publish import write_snapshot
from tests.test_batch_and_quests import setup_files
from tests.test_review_workflow import (  # noqa: F401 — `env` pytest fixture'ı olarak kullanılır
    IDENTITY, REVIEW, Clock, decide, env, login, make_client,
)

OK = "BUR-9001/BUR-9001_test_1.jpeg"
BAD = "BUR-9001/BUR-9001_test_2.jpeg"
OLD = "commons/BUR-9001/abc"
WRITTEN = {"rights_holder": "Vakıf Katılım", "license": "written_permission", "permission_reference": "IZIN-2026-07",
           "attribution": "Fotoğraf: Vakıf Katılım — Bursa Vakıf Eserleri Envanteri", "monument_match": "confirmed"}
CC = {**WRITTEN, "license": "CC-BY-4.0", "permission_reference": None}
REF = {"monument_match": "confirmed", "angle_classes": ["ic_mekan"], "people": "none", "visible_text": "none"}


def _variant(root, name, data):
    d = root / "images" / "hackathon_zip_display" / "BUR-9001"
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_bytes(data)
    return {"relative_path": f"BUR-9001/{name}", "sha256": hashlib.sha256(data).hexdigest(), "size_bytes": len(data),
            "width": 800, "height": 600}


def overlay(env):
    root = env["root"]
    manifest = json.loads((root / "manifests" / "image_manifest.json").read_text())
    second = {**manifest["images"][0], "image_id": BAD, "relative_path": BAD, "sha256": "2" * 64}
    manifest["images"].append(second)
    (root / "manifests" / "image_manifest.json").write_text(json.dumps(manifest))
    items = []
    for iid, sha, status in ((OK, "1" * 64, "celiski_yok"), (BAD, "2" * 64, "belgelenmis_celiski")):
        stem = iid.split("/")[1][:-5]
        items.append({
            "image_id": iid, "monument_id": "BUR-9001",
            "zip": {"path": f"images/Test Eseri(BUR-9001)/{iid.split('/')[1]}", "folder": "Test Eseri(BUR-9001)",
                    "file": iid.split("/")[1], "sha256": sha, "size_bytes": 10,
                    "width": 800, "height": 600, "color_mode": "CMYK"},
            "identity": {"status": status, "summary": "Kitapta başka yapının bölümünde." if status != "celiski_yok" else "Kitapta aynı eser.",
                         "evidence": {}, "proposed_monument_id": None},
            "quality": {"short_side_px": 600, "resolution": "orta"},
            "display": {"detail": _variant(root, f"{stem}-detail.jpg", b"RGB-AYRINTI-" + stem.encode()),
                        "card": _variant(root, f"{stem}-card.jpg", b"RGB-KART-" + stem.encode())},
            "reference_index": {"eligible_now": False, "blocked_by": ["izin_belgesi_bekleniyor"]},
        })
    doc = {"zip": {"name": "test.zip", "sha256": "0" * 64}, "source": {"kind": "hackathon_drive_zip"},
           "rights": {"license_status": "izin_belgesi_bekleniyor"}, "items": items}
    f = env["tmp"] / "zip_overlay.json"
    f.write_text(json.dumps(doc, ensure_ascii=False))
    return f


def test_overlay_keeps_existing_hashes_and_rejects_mismatch(env):
    clock = Clock()
    files = setup_files(env)
    f = overlay(env)
    with make_client(env, clock, **files) as c:
        login(c, env)
        before = c.get(f"/internal/review/subjects/image/{OLD}", headers=REVIEW).json()["subject_sha256"]
        ids = [i["image_id"] for i in c.get("/internal/catalog/images", headers=REVIEW).json()["images"]]
    with make_client(env, clock, **files, zip_overlay_file=f) as c:
        login(c, env)
        assert c.get(f"/internal/review/subjects/image/{OLD}", headers=REVIEW).json()["subject_sha256"] == before
        after = c.get("/internal/catalog/images", headers=REVIEW).json()["images"]
        # Yeni kayıt açılmaz; yalnızca mevcut arşiv kayıtlarına ek bilgi eklenir.
        assert [i["image_id"] for i in after] == ids
        assert next(i for i in after if i["image_id"] == OK)["zip_import"]["entry"]["folder"] == "Test Eseri(BUR-9001)"
    doc = json.loads(f.read_text())
    doc["items"][0]["zip"]["sha256"] = "f" * 64
    f.write_text(json.dumps(doc))
    with pytest.raises(CatalogError, match="eşleşmiyor"):
        make_client(env, clock, **files, zip_overlay_file=f)


def test_zip_rights_need_written_permission_and_conflicts_are_blocked(env, tmp_path):
    clock = Clock()
    with make_client(env, clock, **setup_files(env), zip_overlay_file=overlay(env)) as c:
        login(c, env, "editor")
        assert decide(c, clock, "monument", "BUR-9001", "catalog_identity", source_check="verified_on_page",
                      payload=IDENTITY).status_code == 201
        login(c, env, "rights")
        r = decide(c, clock, "image", BAD, "image_rights", payload=WRITTEN)
        assert r.status_code == 409 and "archive_identity_conflict" in r.text
        r = decide(c, clock, "image", OK, "image_rights", payload=CC)
        assert r.status_code == 409 and "zip_requires_written_permission" in r.text
        assert decide(c, clock, "image", OK, "image_rights", payload=WRITTEN).status_code == 201
        # Referans kullanımı yayından bağımsız; çelişkili fotoğrafa verilemez.
        assert decide(c, clock, "image", OK, "image_reference_index", payload=REF).status_code == 201
        r = decide(c, clock, "image", BAD, "image_reference_index", payload=REF)
        assert r.status_code == 409 and "archive_identity_conflict" in r.text
        svc = c.app.state.review
        assert svc.gates("BUR-9001")["images_reference_index"] == [OK]
        assert OK not in svc.gates("BUR-9001")["images_published"]
        assert decide(c, clock, "image", OK, "image_publication").status_code == 201
        out = tmp_path / "pub" / "catalog.json"
        out.parent.mkdir()
        write_snapshot(svc, out, env["root"] / "images" / "monuments", "test", commons_dir=env["root"] / "images" / "commons")
        (m,) = json.loads(out.read_text())["monuments"]
        img = next(i for i in m["images"] if i["image_id"] == OK)
        # Özgün CMYK dosyası değil, sRGB görüntüleme kopyası yayımlanır; kaynak adı ve izin kaydı taşınır.
        assert (out.parent / "media" / img["file"]).read_bytes().startswith(b"RGB-AYRINTI-")
        assert img["source_label"].startswith("Vakıf Katılım") and img["license"] == "written_permission"
        assert all(i["image_id"] != BAD for i in m["images"])


def test_internal_gallery_sections_and_media(env):
    clock = Clock()
    with make_client(env, clock, **setup_files(env), zip_overlay_file=overlay(env)) as c:
        assert c.get("/internal/review/gallery/BUR-9001").status_code == 401
        login(c, env)
        g = c.get("/internal/review/gallery/BUR-9001", headers=REVIEW).json()
        assert g["public"] is False
        assert [i["image_id"] for i in g["sections"]["zip_gallery"]] == [OK]
        assert [i["image_id"] for i in g["sections"]["zip_review"]] == [BAD]
        assert g["sections"]["zip_gallery"][0]["source"].startswith("Hackathon veri paketi (ZIP)")
        assert g["sections"]["zip_gallery"][0]["rights"]["image_rights"] == "pending"
        r = c.get(f"/internal/review/media/detail/{OK}", headers=REVIEW)
        assert r.status_code == 200 and r.content.startswith(b"RGB-AYRINTI-")
        assert c.get(f"/internal/review/media/card/{OK}", headers=REVIEW).content.startswith(b"RGB-KART-")
