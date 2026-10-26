"""Gerçek 10 eser için araştırma dosyası, inceleme kuyruğu ve yayın kapıları.

Araştırma dosyası testleri her ortamda çalışır; V20 ile birlikte olanlar korumalı veri dizini gerektirir. Gerçek inceleme
veritabanına yazılmaz: her test geçici bir veritabanı kullanır.
"""

import json
import secrets

import pytest
from fastapi.testclient import TestClient

from app.internal import config
from app.internal.publish import build_snapshot
from app.internal.research import MonumentResearch
from app.internal.server import create_internal_app
from app.main import DEFAULT_CORS_ORIGINS, DEFAULT_PLACES_FILE, create_app
from tests.test_internal_catalog import EXPECTED_MONUMENT_IDS, REAL_DATA_DIR, real_data

TOKEN = secrets.token_urlsafe(32)
REVIEW = {"X-Vakifname-Review": "1"}
RESEARCH = json.loads(config.DEFAULT_RESEARCH_FILE.read_text(encoding="utf-8"))


# --- Araştırma dosyası (her ortamda) ---------------------------------------------------


def test_research_covers_all_ten_monuments_completely():
    records = [MonumentResearch(**m) for m in RESEARCH["monuments"]]
    assert {r.monument_id for r in records} == EXPECTED_MONUMENT_IDS
    for r in records:
        assert r.full_name and r.type and r.city == "Bursa" and r.district == "Osmangazi"
        assert r.address_claims, r.monument_id
        kinds = {s.kind for s in r.sources}
        # Her eser için en az bir resmî portal kaydı ve V20 kaynak PDF'inde fiziksel sayfa.
        assert "official_portal" in kinds and "v20_source_pdf" in kinds, r.monument_id
        for s in r.sources:
            if s.kind == "v20_source_pdf":
                assert s.pdf_file in ("bursa-envanteri-cilt-1.pdf", "bursa-envanteri-cilt-2.pdf")
                assert s.pdf_physical_page >= 1
        assert r.site_context.access_notes and r.vgm_search


def test_research_never_claims_verified_coordinates():
    assert RESEARCH["policy"]["coordinates_verified_in_file"] is False
    for m in RESEARCH["monuments"]:
        r = MonumentResearch(**m)
        assert r.location_status in ("missing", "unverified")
        for c in r.location_candidates:
            assert c.status == "unverified" and c.reviewed_by is None and c.reviewed_at is None
            assert c.crs == "EPSG:4326" and c.estimated_accuracy_m > 0
            assert (c.latitude, c.longitude) != (0.0, 0.0)
            assert r.source(c.source_id).url is not None and c.source_object


def test_known_conflicts_are_recorded_not_hidden():
    by_id = {m["monument_id"]: m for m in RESEARCH["monuments"]}
    topics = {d["discrepancy_id"] for m in RESEARCH["monuments"] for d in m["discrepancies"]}
    assert {"D-0008-01", "D-0020-01", "D-0014-01"} <= topics
    # Cem Sultan Türbesi için birbiriyle çelişen iki harita adayı ayrı tutulur.
    assert len(by_id["BUR-0008"]["location_candidates"]) == 2


# --- Gerçek V20 ile -------------------------------------------------------------------


@pytest.fixture(scope="module")
def real(tmp_path_factory):
    db = tmp_path_factory.mktemp("review") / "review.sqlite3"
    app = create_internal_app(REAL_DATA_DIR, TOKEN, allowed_client_hosts=frozenset({"testclient"}),
                              research_file=config.DEFAULT_RESEARCH_FILE, review_db=db)
    with TestClient(app) as c:
        assert c.post("/internal/session", headers=REVIEW, json={"token": TOKEN}).status_code == 204
        yield c


@real_data
def test_real_review_queue_counts(real):
    o = real.get("/internal/review/overview", headers=REVIEW).json()
    assert o["subjects"] == {"facts": 80, "drafts_quarantined": 57, "issues": 6, "images": 325, "sources": 3}
    for dtype in ("fact_editorial", "fact_publication", "fact_game_use"):
        assert o["counts"][dtype]["pending"] == 80 and o["counts"][dtype]["approved"] == 0
    assert o["counts"]["draft_triage"]["pending"] == 57
    for dtype in ("image_rights", "image_publication", "image_game_use"):
        assert o["counts"][dtype]["pending"] == 325
    for dtype in ("catalog_identity", "location_verification", "location_map_display", "gps_checkin"):
        assert o["counts"][dtype]["pending"] == 10
    assert o["counts"]["issue_resolution"]["pending"] == 6


@real_data
def test_real_open_issues_are_listed_with_orhan_gazi_conflict(real):
    issues = {i["issue_id"]: i for i in real.get("/internal/review/overview", headers=REVIEW).json()["issues"]}
    assert len(issues) == 6
    orhan = issues["BUR-0020-ISSUE-001"]
    assert orhan["competing_years"] == [1863, 1868] and orhan["resolution"]["status"] == "pending"
    assert set(orhan["related_fact_ids"]) == {"BUR-0020-F004", "BUR-0020-F007"}


@real_data
def test_real_every_fact_is_separately_reviewable(real):
    for mid in EXPECTED_MONUMENT_IDS:
        detail = real.get(f"/internal/catalog/monuments/{mid}", headers=REVIEW).json()
        for f in detail["facts"]:
            s = real.get(f"/internal/review/subjects/fact/{f['fact_id']}", headers=REVIEW).json()
            assert s["content"]["fact_id"] == f["fact_id"] and len(s["subject_sha256"]) == 64
            assert {k: v["status"] for k, v in s["decisions"].items()} == {
                "fact_editorial": "pending", "fact_publication": "pending", "fact_game_use": "pending"}


@real_data
def test_real_locations_are_unverified_and_not_mappable(real):
    rows = real.get("/internal/catalog/monuments", headers=REVIEW).json()
    assert len(rows) == 10
    for r in rows:
        assert r["location"]["status"] == "unverified" and r["location"]["verified_by"] is None
        assert r["map_eligible"] is False and r["checkin_eligible"] is False
        assert "location_unverified" in r["review"]["public_release_blockers"]
    status = real.get("/internal/status", headers=REVIEW).json()
    assert status["locations"] == {"missing": 0, "unverified": 10, "verified": 0}


@real_data
def test_real_image_manifest_statuses_preserved(real):
    images = real.get("/internal/catalog/images", headers=REVIEW).json()["images"]
    assert len(images) == 325
    assert {(i["license_status"], i["publication_status"], i["public_serving_allowed"]) for i in images} == {
        ("not_checked", "blocked", False)}


@real_data
def test_real_publication_is_empty_and_public_api_says_so(real, tmp_path):
    snapshot, media = build_snapshot(real.app.state.review)
    assert snapshot.monuments == () and media == []
    preview = real.get("/internal/review/publication-preview", headers=REVIEW).json()
    assert preview["monuments_publishable"] == 0 and preview["empty_reason"]
    out = tmp_path / "catalog.json"
    out.write_text(json.dumps(snapshot.model_dump(mode="json", by_alias=True)), encoding="utf-8")
    with TestClient(create_app(DEFAULT_PLACES_FILE, cors_origins=DEFAULT_CORS_ORIGINS, public_catalog_file=out)) as c:
        assert c.get("/monuments").json()["published_count"] == 0
        for mid in EXPECTED_MONUMENT_IDS:
            assert c.get(f"/monuments/{mid}").status_code == 404
        # Genel platform varsayılan olarak kurgusal demo mekânlarını sunmaz.
        assert c.get("/places").status_code == 404


@real_data
def test_real_location_candidates_table(real):
    body = real.get("/internal/review/location-candidates", headers=REVIEW).json()
    rows = {r["candidate_id"]: r for r in body["candidates"]}
    assert len(rows) == 15 and body["monuments_with_candidates"] == 10
    assert body["verified"] == 0 and body["entry_points_available"] == 0
    assert all(r["status"] == "unverified" and "centroid_not_entrance" in r["flags"] for r in rows.values())
    # Cem Sultan Türbesi: iki rakip yapı adayı, aynı tutarsızlık kaydına bağlı.
    for cid in ("LC-0008-01", "LC-0008-02"):
        assert "competing_candidate" in rows[cid]["flags"] and rows[cid]["competing_discrepancy_ids"] == ["D-0008-01"]
    assert rows["LC-0008-01"]["other_candidates"][0]["distance_m"] > 25
    # Bedesten: kullanım alanı, bina izi değil.
    assert "area_not_building" in rows["LC-0014-01"]["flags"]
    # Osman Gazi ve Orhan Gazi türbeleri check-in yarıçapında karışabilir.
    assert "near_other_monument" in rows["LC-0019-01"]["flags"] and "near_other_monument" in rows["LC-0020-01"]["flags"]


@real_data
def test_real_candidates_belong_to_their_monument(real):
    research = {m["monument_id"]: m for m in RESEARCH["monuments"]}
    rows = real.get("/internal/review/location-candidates", headers=REVIEW).json()["candidates"]
    for r in rows:
        own = research[r["monument_id"]]
        assert r["candidate_id"].startswith(f"LC-{r['monument_id'][4:]}-")
        assert r["monument_name"] == own["full_name"]
        src = next(c for c in own["location_candidates"] if c["candidate_id"] == r["candidate_id"])
        assert (r["latitude"], r["longitude"], r["source_object"]) == (src["latitude"], src["longitude"], src["source_object"])
    assert {r["monument_id"] for r in rows} == EXPECTED_MONUMENT_IDS
