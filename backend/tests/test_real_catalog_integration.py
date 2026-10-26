"""Gerçek eser kataloğu entegrasyonu: demo/gerçek ayrımı, konum kaydı, inceleme durumu ve yetkili oturum."""

import json
import secrets
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.internal.catalog import (
    CatalogError,
    LocationRecord,
    LocationUnavailableError,
    RealMonument,
    load_catalog,
    load_source_audit,
    to_checkin_place,
)
from app.internal.images import load_image_inventory
from app.internal.review import review_status
from app.internal.server import MAX_FAILED_LOGINS, SESSION_COOKIE, create_internal_app
from app.main import DEFAULT_CORS_ORIGINS, DEFAULT_PLACES_FILE, create_app
from app.models import DemoPlace
from app.services import PlaceRepository
from tests.conftest import temp_review_db
from tests.internal_fixtures import write_data_dir
from tests.test_internal_catalog import EXPECTED_MONUMENT_IDS, REAL_DATA_DIR, build, real_data

BACKEND_DIR = Path(__file__).resolve().parents[1]
TOKEN = secrets.token_urlsafe(32)
TEST_HOSTS = frozenset({"testclient"})
REVIEW = {"X-Vakifname-Review": "1"}

DEMO_BASE = {
    "name": "Demo", "city": "Demo", "description": "", "latitude": 0, "longitude": 0,
    "check_in_radius_m": 10, "is_demo": True,
}


# --- Demo ve gerçek eser modelleri ayrı -------------------------------------------


@pytest.mark.parametrize("place_id", ["BUR-0001", "bur-0020", " BUR-9999", "Bur-x"])
def test_demo_place_cannot_use_real_monument_id(place_id):
    with pytest.raises(ValidationError):
        DemoPlace(id=place_id, **DEMO_BASE)


def test_demo_place_must_be_marked_demo():
    with pytest.raises(ValidationError):
        DemoPlace(id="demo-x", **{**DEMO_BASE, "is_demo": False})


def test_real_monument_cannot_be_injected_into_demo_dataset(tmp_path):
    # Gerçek bir eseri kurgusal demo koordinatlarıyla oyuna eklemek veri yüklenirken reddedilir.
    path = tmp_path / "places.json"
    path.write_text(json.dumps([{"id": "BUR-0001", **{**DEMO_BASE, "name": "Ulucami"}}]), encoding="utf-8")
    with pytest.raises(ValidationError):
        PlaceRepository(path)


def test_real_monument_requires_bur_id():
    m = build().monuments["BUR-9001"]
    with pytest.raises(ValidationError):
        RealMonument(**{**m.model_dump(), "monument_id": "demo-mekan-a"})


def test_default_demo_ids_never_look_like_real_ids():
    ids = {p.id for p in PlaceRepository(DEFAULT_PLACES_FILE).list()}
    assert ids == {"demo-mekan-a", "demo-mekan-b", "demo-mekan-c"}
    assert not [i for i in ids if i.upper().startswith("BUR-")]


# --- Konum kaydı ------------------------------------------------------------------

VERIFIED = {
    "status": "verified", "latitude": 40.18, "longitude": 29.06, "source": "field_survey_gnss",
    "source_reference": "ÖLÇÜM-001", "accuracy_m": 5.0, "verified_by": "editör",
    "verified_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
}


@pytest.mark.parametrize(
    "fields",
    [
        pytest.param({"status": "missing", "latitude": 40.0, "longitude": 29.0}, id="missing_with_coordinates"),
        pytest.param({"status": "unverified"}, id="unverified_without_coordinates"),
        pytest.param({"status": "unverified", "latitude": 40.0}, id="half_coordinate"),
        pytest.param({**VERIFIED, "status": "unverified"}, id="unverified_with_verifier"),
        pytest.param({**VERIFIED, "source": None}, id="verified_without_source"),
        pytest.param({**VERIFIED, "source_reference": None}, id="verified_without_reference"),
        pytest.param({**VERIFIED, "accuracy_m": None}, id="verified_without_accuracy"),
        pytest.param({**VERIFIED, "verified_at": None}, id="verified_without_date"),
        pytest.param({**VERIFIED, "source": "geocoder_guess"}, id="unknown_source"),
    ],
)
def test_location_record_rules(fields):
    with pytest.raises(ValidationError):
        LocationRecord(**fields)


def test_verified_location_alone_does_not_open_check_in():
    m = build().monuments["BUR-9001"]
    verified = m.model_copy(update={"location": LocationRecord(**VERIFIED)})
    assert verified.location.mappable is True
    # Eser yayına açılmadıkça (publication_status) doğrulanmış konum bile check-in'e izin vermez.
    assert verified.checkin_eligible is False
    with pytest.raises(LocationUnavailableError):
        to_checkin_place(verified)


# --- Kaynak sayfa denetimi ve inceleme durumu ------------------------------------


def _audit_file(tmp_path, records, numbering="physical_1_based"):
    path = tmp_path / "audit.json"
    path.write_text(json.dumps({"page_numbering": numbering, "records": records}), encoding="utf-8")
    return path


def test_source_audit_must_match_catalog_reference(tmp_path):
    c = build()
    ok = {"record_id": "BUR-9001-F001", "kind": "fact", "source_file": "kaynak-a.pdf",
          "pdf_physical_page": 2, "result": "quote_found_on_page"}
    assert load_source_audit(_audit_file(tmp_path, [ok]), c)["BUR-9001-F001"].result == "quote_found_on_page"
    for bad in ({**ok, "pdf_physical_page": 4}, {**ok, "record_id": "BUR-9001-F099"}, {**ok, "result": "ok"}):
        with pytest.raises(CatalogError):
            load_source_audit(_audit_file(tmp_path, [bad]), c)
    with pytest.raises(CatalogError):
        load_source_audit(_audit_file(tmp_path, [ok], numbering="printed"), c)
    assert load_source_audit(tmp_path / "yok.json", c) == {}


def test_review_status_lists_every_release_blocker(tmp_path):
    root = write_data_dir(tmp_path / "d")
    c = load_catalog(root)
    inv = load_image_inventory(root / "manifests" / "image_manifest.json", set(c.monuments))
    r = review_status(c, inv, {}, "BUR-9001")
    assert set(r.public_release_blockers) == {
        "editor_review_pending", "publication_blocked", "license_review_pending", "location_missing",
        "facts_not_approved", "source_audit_incomplete", "open_editorial_issues",
    }
    assert r.source_audit == {"not_audited": 2}
    assert (r.facts_publicly_usable, r.images_publishable, r.images_license_pending) == (0, 0, 1)


# --- Yetkili inceleme oturumu (tarayıcı akışı) ------------------------------------


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def internal(tmp_path, clock):
    app = create_internal_app(write_data_dir(tmp_path / "d"), TOKEN, allowed_client_hosts=TEST_HOSTS,
                              session_ttl_s=60, clock=clock)
    with TestClient(app) as c:
        yield c


def login(client, token=TOKEN, headers=REVIEW):
    return client.post("/internal/session", headers=headers, json={"token": token})


def test_session_login_sets_hardened_cookie(internal):
    r = login(internal)
    assert r.status_code == 204 and r.content == b""
    cookie = r.headers["set-cookie"]
    assert cookie.startswith(f"{SESSION_COOKIE}=")
    assert TOKEN not in cookie
    for attr in ("HttpOnly", "SameSite=strict", "Path=/internal", "Max-Age=60"):
        assert attr in cookie
    assert internal.get("/internal/catalog/monuments", headers=REVIEW).status_code == 200
    assert internal.get("/internal/session", headers=REVIEW).json()["authenticated"] is True


def test_session_requires_review_header(internal):
    # Başlıksız istek, başka bir origin'den çerezle gönderilen istek gibidir (CSRF).
    assert login(internal, headers={}).status_code == 401
    assert login(internal).status_code == 204
    assert internal.get("/internal/catalog/monuments").status_code == 401
    assert internal.get("/internal/catalog/monuments", headers={"X-Vakifname-Review": "0"}).status_code == 401


@pytest.mark.parametrize("bad", ["", "yanlis", TOKEN + "x", TOKEN[:-1]])
def test_session_wrong_token_rejected(internal, bad):
    r = login(internal, token=bad)
    assert r.status_code in (401, 422)
    assert SESSION_COOKIE not in r.headers.get("set-cookie", "")
    assert internal.get("/internal/catalog/monuments", headers=REVIEW).status_code == 401


def test_forged_session_cookie_rejected(internal):
    internal.cookies.set(SESSION_COOKIE, secrets.token_urlsafe(32), path="/internal")
    assert internal.get("/internal/catalog/monuments", headers=REVIEW).status_code == 401


def test_session_expires(internal, clock):
    login(internal)
    clock.now += 61
    assert internal.get("/internal/catalog/monuments", headers=REVIEW).status_code == 401
    assert internal.get("/internal/session", headers=REVIEW).status_code == 401


def test_logout_revokes_session(internal):
    login(internal)
    sid = internal.cookies.get(SESSION_COOKIE)
    assert internal.delete("/internal/session", headers=REVIEW).status_code == 204
    # Çerez istemcide kalsa bile sunucu oturumu artık tanımaz.
    internal.cookies.set(SESSION_COOKIE, sid, path="/internal")
    assert internal.get("/internal/catalog/monuments", headers=REVIEW).status_code == 401


def test_repeated_wrong_tokens_lock_login(internal, clock):
    for _ in range(MAX_FAILED_LOGINS):
        assert login(internal, token="yanlis-anahtar").status_code == 401
    assert login(internal).status_code == 429
    clock.now += 61
    assert login(internal).status_code == 204


def test_internal_responses_are_not_cached(internal):
    for r in (internal.get("/internal/catalog/monuments"), login(internal),
              internal.get("/internal/catalog/monuments", headers=REVIEW)):
        assert r.headers["cache-control"] == "no-store"


def test_session_endpoints_loopback_only(tmp_path):
    with TestClient(create_internal_app(write_data_dir(tmp_path / "d"), TOKEN)) as c:
        assert login(c).status_code == 403
        assert c.get("/internal/session", headers=REVIEW).status_code == 403


def test_internal_app_has_no_check_in_route(internal):
    paths = [getattr(r, "path", "") for r in internal.app.routes]
    assert not [p for p in paths if "check-in" in p or "quests" in p]


# --- Genel API yalıtımı -----------------------------------------------------------


def test_public_app_does_not_import_internal_package():
    code = "import sys, app.main; sys.exit(any(m.startswith('app.internal') for m in sys.modules))"
    assert subprocess.run([sys.executable, "-c", code], cwd=BACKEND_DIR).returncode == 0


# --- Gerçek V20 verisiyle ---------------------------------------------------------


@pytest.fixture(scope="module")
def real_internal():
    with TestClient(create_internal_app(REAL_DATA_DIR, TOKEN, allowed_client_hosts=TEST_HOSTS,
                                        review_db=temp_review_db())) as c:
        assert login(c).status_code == 204
        yield c


@real_data
def test_real_inventory_lists_all_ten_monuments(real_internal):
    rows = real_internal.get("/internal/catalog/monuments", headers=REVIEW).json()
    ids = [r["monument_id"] for r in rows]
    assert len(ids) == 10 and set(ids) == EXPECTED_MONUMENT_IDS
    for r in rows:
        assert r["name"] and r["location"]["status"] == "missing"
        assert r["checkin_eligible"] is False and r["map_eligible"] is False
        review = r["review"]
        assert {"location_missing", "facts_not_approved", "publication_blocked"} <= set(review["public_release_blockers"])
        assert review["facts_publicly_usable"] == 0 and review["images_publishable"] == 0
    assert sum(r["fact_count"] for r in rows) == 80
    assert sum(r["quarantined_draft_count"] for r in rows) == 57
    assert sum(r["image_count"] for r in rows) == 325


@real_data
def test_real_status_counts(real_internal):
    body = real_internal.get("/internal/status", headers=REVIEW).json()
    assert body["counts"]["monuments"] == 10 and body["counts"]["existing_historical_facts"] == 80
    assert body["counts"]["unapproved_drafts"] == 57 and body["images"] == 325
    assert body["locations"] == {"missing": 10, "unverified": 0, "verified": 0}
    assert body["source_audit_loaded"] is True and body["public_access"] is False


@real_data
def test_real_source_references_reviewable_with_session(real_internal):
    for mid in EXPECTED_MONUMENT_IDS:
        m = real_internal.get(f"/internal/catalog/monuments/{mid}", headers=REVIEW).json()
        assert m["facts"]
        for f in m["facts"]:
            src = f["source"]
            assert src["pdf_page_kind"] == "physical"
            assert 1 <= src["pdf_physical_page"] <= src["pdf_physical_page_count"]
            assert src["page_audit"] == "quote_found_on_page"
            assert f["publicly_usable"] is False
    drafts = real_internal.get("/internal/catalog/drafts", headers=REVIEW).json()["drafts"]
    assert len(drafts) == 57 and all(d["page_audit"] != "not_audited" for d in drafts)


@real_data
def test_real_content_endpoints_reject_unauthorized():
    with TestClient(create_internal_app(REAL_DATA_DIR, TOKEN, allowed_client_hosts=TEST_HOSTS,
                                        review_db=temp_review_db())) as c:
        for path in ("/internal/status", "/internal/catalog/monuments", "/internal/catalog/monuments/BUR-0001",
                     "/internal/catalog/facts/BUR-0001-F001", "/internal/catalog/drafts", "/internal/catalog/images"):
            for headers in ({}, REVIEW, {"X-Internal-Token": "yanlis"}):
                r = c.get(path, headers=headers)
                assert r.status_code == 401, (path, headers)
                assert "BUR-0001" not in r.text


@real_data
def test_public_api_leaks_no_real_content():
    catalog = load_catalog(REAL_DATA_DIR)
    inv = load_image_inventory(REAL_DATA_DIR / "manifests" / "image_manifest.json", set(catalog.monuments))
    secrets_ = {m.name for m in catalog.monuments.values()} | set(catalog.monuments)
    secrets_ |= {f.text for f in catalog.facts.values()} | {f.source.evidence_quote for f in catalog.facts.values()}
    secrets_ |= {d.statement for d in catalog.drafts.values()} | {i.image_id for i in inv.images}

    with TestClient(create_app(DEFAULT_PLACES_FILE, cors_origins=DEFAULT_CORS_ORIGINS, demo_api=True)) as c:
        bodies = [c.get(p).text for p in ("/", "/places", "/openapi.json", "/users/u/passport")]
        for place in c.get("/places").json():
            bodies.append(c.get(f"/places/{place['id']}").text)
            bodies.append(c.post(f"/quests/{place['id']}/check-in", json={
                "user_id": "u", "latitude": place["latitude"], "longitude": place["longitude"]}).text)
        bodies.append(c.get("/users/u/passport").text)
        for mid in catalog.monuments:
            assert c.get(f"/places/{mid}").status_code == 404
            assert c.post(f"/quests/{mid}/check-in", json={"user_id": "u", "latitude": 40.18,
                                                           "longitude": 29.06}).status_code == 404
    blob = "\n".join(bodies)
    leaked = [s for s in secrets_ if s and s in blob]
    assert leaked == []


@real_data
def test_real_and_demo_ids_disjoint():
    real_ids = set(load_catalog(REAL_DATA_DIR).monuments)
    demo_ids = {p.id for p in PlaceRepository(DEFAULT_PLACES_FILE).list()}
    assert real_ids == EXPECTED_MONUMENT_IDS and not real_ids & demo_ids
