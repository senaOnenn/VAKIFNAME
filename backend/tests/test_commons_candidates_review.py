"""Görev 29: yeni Commons adaylarının mevcut inceleme akışına alınması ve bağımsız hak / yayın / referans indeksi kararları.

Kurgusal veriyle; gerçek inceleme veritabanına veya görsellere dokunmaz.
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

from app.internal.catalog import CatalogError
from app.internal.publish import write_snapshot
from tests.test_batch_and_quests import PUBLISH, setup_files
from tests.test_review_workflow import (  # noqa: F401 — `env` pytest fixture'ı olarak kullanılır
    IDENTITY, IMAGE_RIGHTS, REVIEW, Clock, decide, env, login, make_client,
)

CAND = "commons/BUR-9001/c0ffee0000000001"
OLD = "commons/BUR-9001/abc"
REF_INDEX = {"monument_match": "confirmed", "angle_classes": ["dis_cephe"], "people": "none", "visible_text": "none"}
HOLDOUT = "visual_index/test_sets/commons_holdout_v1/manifest.json"


def _media(root: Path, name: str, data: bytes) -> tuple[str, int]:
    d = root / "images" / "commons" / "BUR-9001"
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_bytes(data)
    return hashlib.sha256(data).hexdigest(), len(data)


def candidates_doc(root: Path, image_id=CAND, title="File:Aday.jpg"):
    hid = image_id.rsplit("/", 1)[1]
    det = _media(root, f"{hid}-1600.jpg", b"ADAY-AYRINTI-" + hid.encode())
    card = _media(root, f"{hid}-card.jpg", b"ADAY-KART-" + hid.encode())
    return {"batch_id": "test-aday-v1", "images": [{
        "image_id": image_id, "monument_id": "BUR-9001", "relative_path": f"BUR-9001/{hid}-1600.jpg",
        "sha256": det[0], "size_bytes": det[1], "width": 1600, "height": 1067,
        "card": {"relative_path": f"BUR-9001/{hid}-card.jpg", "sha256": card[0], "size_bytes": card[1],
                 "width": 900, "height": 600},
        "rank": 6,
        "commons": {"title": title, "file_page_url": "https://commons.wikimedia.org/wiki/File:Aday.jpg",
                    "license_short_name": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0",
                    "artist": "Aday Fotoğrafçı", "commons_sha1": "a" * 40, "thumb_url": None},
        "verification": {"monument_match": "Masa başı eşleşme; editör onayı gerekir.", "notes": "dış cephe"},
        "review": {"by": "test", "angles": ["dis_cephe", "kubbe_minare"], "people": 1, "sign_or_text": 0,
                   "identity_evidence": ["Kamera EXIF GPS konumu esere 20 m."], "confusion_risk": "Düşük",
                   "doubts": ["Karede uzak/küçük insan figürü var."]},
        "proposed_rights": {"rights_holder": "Aday Fotoğrafçı", "license": "CC-BY-3.0",
                            "attribution": "Fotoğraf: Aday Fotoğrafçı, CC BY 3.0, Wikimedia Commons",
                            "source_url": "https://commons.wikimedia.org/wiki/File:Aday.jpg"},
    }]}


def setup(env, holdout_items=()):
    files = setup_files(env)
    cand = env["tmp"] / "candidates.json"
    cand.write_text(json.dumps(candidates_doc(env["root"]), ensure_ascii=False), encoding="utf-8")
    h = env["root"] / HOLDOUT
    h.parent.mkdir(parents=True, exist_ok=True)
    h.write_text(json.dumps({"test_set_id": "t", "manifest_sha256": "x", "items": list(holdout_items)}), encoding="utf-8")
    return {**files, "candidates_file": cand}


def rights_payload(c, image_id):
    listing = c.get("/internal/review/batch", headers=REVIEW).json()
    row = next(i for st in listing["stages"] for i in st["items"]
               if i["decision_type"] == "image_rights" and i["subject_id"] == image_id)
    return row["payload"]


def test_candidates_load_only_when_configured_and_keep_existing_subject_hashes(env):
    clock = Clock()
    files = setup(env)
    without = {k: v for k, v in files.items() if k != "candidates_file"}
    with make_client(env, clock, **without) as c:
        login(c, env)
        ids = [i["image_id"] for i in c.get("/internal/catalog/images", headers=REVIEW).json()["images"]]
        assert CAND not in ids
        before = c.get(f"/internal/review/subjects/image/{OLD}", headers=REVIEW).json()["subject_sha256"]
    with make_client(env, clock, **files) as c:
        login(c, env)
        ids = [i["image_id"] for i in c.get("/internal/catalog/images", headers=REVIEW).json()["images"]]
        assert CAND in ids and ids.count(CAND) == 1
        # Eklenen adaylar mevcut fotoğrafın konu özetini değiştirmez; eski kararlar eskimez.
        assert c.get(f"/internal/review/subjects/image/{OLD}", headers=REVIEW).json()["subject_sha256"] == before


def test_batch_rows_for_candidate_require_explicit_match_and_do_not_recommend_publication(env):
    clock = Clock()
    with make_client(env, clock, **setup(env)) as c:
        login(c, env, "rights")
        listing = c.get("/internal/review/batch", headers=REVIEW).json()
        rows = {(i["decision_type"], i["subject_id"]): i for st in listing["stages"] for i in st["items"]}
        rights = rows[("image_rights", CAND)]
        assert "monument_match" not in rights["payload"]
        assert rights["image_facts"]["candidate_batch"] == "test-aday-v1"
        assert rights["image_facts"]["license_url"].endswith("/by/3.0")
        assert rights["media_url"] == f"/internal/review/media/card/{CAND}"
        assert any(e["label"].startswith("Kimlik kanıtı") for e in rights["evidence"])
        assert rows[("image_publication", CAND)]["recommended"] is False
        assert ("image_game_use", CAND) not in rows
        ref = rows[("image_reference_index", CAND)]
        assert ref["payload"] == {"angle_classes": ["dis_cephe", "kubbe_minare"], "people": "incidental", "visible_text": "none"}
        assert ref["depends_on"] == [f"image_rights|{CAND}"]
        # Eski onaylı akış değişmedi: oyun kullanımı ve yayın önerisi korunur.
        assert rows[("image_publication", OLD)]["recommended"] is True and ("image_game_use", OLD) in rows


def test_rights_publication_and_reference_index_are_independent(env, tmp_path):
    clock = Clock()
    with make_client(env, clock, **setup(env)) as c:
        login(c, env, "editor")
        assert decide(c, clock, "monument", "BUR-9001", "catalog_identity", source_check="verified_on_page",
                      payload=IDENTITY).status_code == 201
        login(c, env, "rights")
        # Eser eşleşmesi işaretlenmeden hak kaydı onaylanamaz.
        assert decide(c, clock, "image", CAND, "image_rights", payload=rights_payload(c, CAND)).status_code == 422
        # Hak kaydı yokken ne yayın ne referans kullanımı onaylanır.
        r = decide(c, clock, "image", CAND, "image_reference_index", payload=REF_INDEX)
        assert r.status_code == 409 and "image_rights" in r.text
        assert decide(c, clock, "image", CAND, "image_publication").status_code == 409
        ok_rights = {**rights_payload(c, CAND), "monument_match": "confirmed"}
        assert decide(c, clock, "image", CAND, "image_rights", payload=ok_rights).status_code == 201
        # Referans kullanımı için de eşleşme açıkça işaretlenmeli.
        no_match = {k: v for k, v in REF_INDEX.items() if k != "monument_match"}
        assert decide(c, clock, "image", CAND, "image_reference_index", payload=no_match).status_code == 422
        assert decide(c, clock, "image", CAND, "image_reference_index", payload=REF_INDEX).status_code == 201
        svc = c.app.state.review
        gates = svc.gates("BUR-9001")
        assert gates["images_reference_index"] == [CAND] and gates["images_published"] == []
        out = tmp_path / "pub" / "catalog.json"
        out.parent.mkdir()
        write_snapshot(svc, out, env["root"] / "images" / "monuments", "test", commons_dir=env["root"] / "images" / "commons")
        assert all(i["image_id"] != CAND for m in json.loads(out.read_text())["monuments"] for i in m["images"])
        # Eski fotoğraf: yayın onayı referans kullanımı doğurmaz.
        assert decide(c, clock, "image", OLD, "image_rights", payload=rights_payload(c, OLD)).status_code == 201
        assert decide(c, clock, "image", OLD, "image_publication").status_code == 201
        gates = svc.gates("BUR-9001")
        assert gates["images_published"] == [OLD] and gates["images_reference_index"] == [CAND]
        # Hak kaydı sonradan reddedilirse referans kullanımı da düşer.
        assert decide(c, clock, "image", CAND, "image_rights", decision="rejected").status_code == 201
        assert svc.gates("BUR-9001")["images_reference_index"] == []
        assert not svc.image_reference_index_usable(CAND)


def test_reference_index_needs_rights_role_and_rejects_book_archive_images(env):
    clock = Clock()
    with make_client(env, clock, **setup(env)) as c:
        login(c, env, "editor")
        assert decide(c, clock, "image", CAND, "image_reference_index", payload=REF_INDEX).status_code == 403
        login(c, env, "rights")
        arch = "BUR-9001/BUR-9001_test_1.jpeg"
        assert decide(c, clock, "image", arch, "image_rights", payload=IMAGE_RIGHTS).status_code == 201
        r = decide(c, clock, "image", arch, "image_reference_index", payload=REF_INDEX)
        assert r.status_code == 409 and "collection_not_allowed_for_reference_index" in r.text


def test_holdout_test_images_cannot_enter_the_inventory(env):
    files = setup(env, holdout_items=[{"image_id": CAND, "commons_title": "File:Başka.jpg", "commons_sha1": "b" * 40}])
    with pytest.raises(CatalogError, match="Test kümesindeki"):
        make_client(env, Clock(), **files)
    # Kimlik farklı olsa da aynı Commons dosyası test kümesindeyse yine alınmaz.
    (env["root"] / HOLDOUT).write_text(json.dumps({"items": [
        {"image_id": "x", "commons_title": "File:Aday.jpg", "commons_sha1": "c" * 40}]}), encoding="utf-8")
    with pytest.raises(CatalogError):
        make_client(env, Clock(), **files)


def test_review_media_is_authorized_and_integrity_checked(env):
    clock = Clock()
    with make_client(env, clock, **setup(env)) as c:
        assert c.get(f"/internal/review/media/card/{CAND}").status_code == 401
        login(c, env)
        r = c.get(f"/internal/review/media/card/{CAND}", headers=REVIEW)
        assert r.status_code == 200 and r.content.startswith(b"ADAY-KART-") and r.headers["content-type"] == "image/jpeg"
        assert c.get("/internal/review/media/card/BUR-9001/BUR-9001_test_1.jpeg", headers=REVIEW).status_code == 404
        assert c.get(f"/internal/review/media/thumb/{CAND}", headers=REVIEW).status_code == 422
        (env["root"] / "images" / "commons" / "BUR-9001" / "c0ffee0000000001-card.jpg").write_bytes(b"degisti")
        assert c.get(f"/internal/review/media/card/{CAND}", headers=REVIEW).status_code == 409


def _jpeg(path: Path, size=(1600, 1067)) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (120, 90, 60)).save(path, "JPEG")
    b = path.read_bytes()
    return {"sha256": hashlib.sha256(b).hexdigest(), "size_bytes": len(b), "width": size[0], "height": size[1]}


def test_importer_is_idempotent_and_refuses_holdout_leak(tmp_path):
    media, data = tmp_path / "media", tmp_path / "data"
    det = {**_jpeg(media / "BUR-0001/aaaaaaaaaaaaaaaa-1600.jpg"), "relative_path": "BUR-0001/aaaaaaaaaaaaaaaa-1600.jpg"}
    card = {**_jpeg(media / "BUR-0001/aaaaaaaaaaaaaaaa-card.jpg", (900, 600)), "relative_path": "BUR-0001/aaaaaaaaaaaaaaaa-card.jpg"}
    item = {"image_id": "commons/BUR-0001/aaaaaaaaaaaaaaaa", "monument_id": "BUR-0001", "angles": ["dis_cephe"],
            "source": {"title": "File:A.jpg", "file_page_url": "https://commons.wikimedia.org/wiki/File:A.jpg",
                       "original_url": "https://upload.wikimedia.org/a.jpg", "original_width": 4000, "original_height": 3000,
                       "date": "2014", "description": "", "categories_walked": ["Category:Grand Mosque of Bursa"],
                       "commons_sha1": "d" * 40, "commons_review_categories": []},
            "license": {"short_name": "CC BY-SA 4.0", "code": "CC-BY-SA-4.0", "url": "https://creativecommons.org/licenses/by-sa/4.0",
                        "restrictions": None, "obligations": "atıf"},
            "attribution": {"artist": "A Kişi", "credit": "", "text": "Fotoğraf: A Kişi, CC BY-SA 4.0, Wikimedia Commons"},
            "review": {"by": "t", "people": 0, "sign_or_text": 0, "identity_evidence": ["Kamera EXIF GPS konumu esere 5 m."],
                       "confusion_risk": "Düşük", "note": "n"},
            "quality": {"status": "uygun"}, "status": {"approval": "onaya_hazir", "approved_by": None},
            "files": {"detail": det, "card": card}}
    coll = tmp_path / "collection.json"
    coll.write_text(json.dumps({"generated": "2026-10-26", "images": [item], "rejected": [], "harvest": {}}), encoding="utf-8")
    (data / "manifests").mkdir(parents=True)
    (data / "manifests/image_manifest.json").write_text(json.dumps({"images": []}), encoding="utf-8")
    hold = data / HOLDOUT
    hold.parent.mkdir(parents=True)
    hold.write_text(json.dumps({"test_set_id": "t", "manifest_sha256": "m", "count": 0, "items": []}), encoding="utf-8")
    existing = tmp_path / "existing.json"
    existing.write_text(json.dumps({"images": []}), encoding="utf-8")
    out = tmp_path / "out.json"
    script = Path(__file__).resolve().parents[1] / "scripts" / "import_commons_candidates.py"
    run = lambda *x: subprocess.run([sys.executable, str(script), "--collection", str(coll), "--media", str(media),  # noqa: E731
                                     "--data-dir", str(data), "--existing", str(existing), "--out", str(out), *x],
                                    capture_output=True, text=True)
    r = run("--write", "--copy-media")
    assert r.returncode == 0, r.stdout + r.stderr
    first = out.read_bytes()
    r = run("--write", "--copy-media")
    assert r.returncode == 0 and "değişiklik yok" in r.stdout and "yeni 0, zaten var 2" in r.stdout
    assert out.read_bytes() == first
    doc = json.loads(first)
    assert "monument_match" not in doc["images"][0]["proposed_rights"]
    # Test kümesine giren bir dosya içe aktarılmaz.
    hold.write_text(json.dumps({"test_set_id": "t", "manifest_sha256": "m", "count": 1, "items": [
        {"image_id": "z", "commons_title": "File:A.jpg", "commons_sha1": "e" * 40,
         "detail": {"sha256": "0" * 64}, "card": {"sha256": "1" * 64}}]}), encoding="utf-8")
    r = run()
    assert r.returncode == 2 and "test kümesinde" in r.stdout
