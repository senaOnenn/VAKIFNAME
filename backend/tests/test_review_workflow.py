"""Editör onayı iş akışı: kişisel hesap ve rol, tek kayıtlık bilet, kalıcı ve denetlenebilir kararlar, ayrı yayın
kapıları, konum/check-in ayrımı ve yalnızca onaylı içeriğin genel kataloğa geçmesi.

Tüm kayıtlar kurgusaldır (BUR-9xxx); gerçek V20 verisi kullanılmaz.
"""

import json
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.internal.catalog import CatalogError, load_catalog
from app.internal.publish import build_snapshot, write_snapshot
from app.internal.research import CoordinateCandidate, load_research
from app.internal.review_store import ReviewStore
from app.internal.server import create_internal_app
from app.main import DEFAULT_CORS_ORIGINS, create_app
from tests.conftest import TEST_PLACES_FILE
from tests.internal_fixtures import write_data_dir

TOKEN = secrets.token_urlsafe(32)
TEST_HOSTS = frozenset({"testclient"})
REVIEW = {"X-Vakifname-Review": "1"}
RATIONALE = "Kaynak sayfası okundu; ifade kaynakla birebir uyumlu."


def _source(sid, **extra):
    return {"source_id": sid, "kind": "official_portal", "publisher": "Test yayıncı", "title": "Test sayfası",
            "url": "https://example.org/kaynak", "accessed_at": "2026-10-23", "supports": ["identity", "address"],
            "summary": "Kurgusal test kaynağı.", **extra}


def _candidate(cid, sid, lat=40.1839, lon=29.0619, **extra):
    return {"candidate_id": cid, "latitude": lat, "longitude": lon, "crs": "EPSG:4326", "source_id": sid,
            "source_object": "osm:way/1@v1", "represents": "building_footprint_centroid", "estimated_accuracy_m": 20,
            "collection_method": "test", "collected_by": "test", "collected_at": "2026-10-23", "reviewed_by": None,
            "reviewed_at": None, "status": "unverified", **extra}


def _research_monument(mid, candidates=True):
    n = mid[4:]
    return {
        "monument_id": mid, "v20_name": f"Test Eser {mid}", "full_name": f"Test Eseri {mid}", "alternative_names": [],
        "type": "cami", "city": "Test", "district": "Test",
        "address_claims": [{"value": "Test Mahallesi, Test Caddesi", "source_id": f"S-{n}-KP"},
                           {"value": "Kitap Mahallesi, Kaynak Sokak", "source_id": f"S-{n}-PDF"}],
        "sources": [_source(f"S-{n}-KP"), _source(f"S-{n}-OSM", kind="open_map_data", supports=["location"]),
                    _source(f"S-{n}-PDF", kind="v20_source_pdf", url=None, pdf_file="kaynak-a.pdf",
                            pdf_physical_page=2)],
        "discrepancies": [{"discrepancy_id": f"D-{n}-01", "topic": "Test", "description": "Kurgusal tutarsızlık.",
                           "source_ids": [f"S-{n}-OSM"]}],
        "location_candidates": [_candidate(f"LC-{n}-01", f"S-{n}-OSM")] if candidates else [],
        "location_status": "unverified" if candidates else "missing",
        "site_context": {"active_place_of_worship": True, "burial_site": False, "access_notes": "Test notu."},
        "vgm_search": "Test.", "review_status": "research_collected_editor_review_pending",
    }


def research_doc():
    return {"schema_version": "vakifname.monument_research/1", "policy": {"coordinates_verified_in_file": False},
            "monuments": [_research_monument("BUR-9001"), _research_monument("BUR-9002", candidates=False)]}


class Clock:
    """Hem monotonik (bilet bekleme süresi) hem duvar saati (hız sınırı, karar zamanı) için sahte saat."""

    def __init__(self):
        self.t = 1000.0
        self.wall = datetime(2026, 10, 23, 12, 0, tzinfo=timezone.utc)

    def mono(self):
        return self.t

    def now(self):
        return self.wall

    def advance(self, seconds):
        self.t += seconds
        self.wall += timedelta(seconds=seconds)


@pytest.fixture
def env(tmp_path):
    root = write_data_dir(tmp_path / "d")
    audit = {"page_numbering": "physical_1_based", "records": [
        {"record_id": "BUR-9001-F001", "kind": "fact", "source_file": "kaynak-a.pdf", "pdf_physical_page": 2,
         "result": "quote_found_on_page"}]}
    (root / "manifests" / "source_page_audit.json").write_text(json.dumps(audit), encoding="utf-8")
    research = tmp_path / "research.json"
    research.write_text(json.dumps(research_doc(), ensure_ascii=False), encoding="utf-8")
    db = tmp_path / "review" / "review.sqlite3"
    store = ReviewStore(db)
    creds = {
        "editor": store.add_reviewer("editor.a", "Editör A", ("editor",), created_by="test"),
        "editor2": store.add_reviewer("editor.b", "Editör B", ("editor",), created_by="test"),
        "rights": store.add_reviewer("rights.a", "Hak İncelemecisi", ("rights",), created_by="test"),
        "location": store.add_reviewer("location.a", "Konum İncelemecisi", ("location",), created_by="test"),
    }
    store.close()
    return {"root": root, "research": research, "db": db, "creds": creds, "tmp": tmp_path}


def make_client(env, clock, **kw):
    app = create_internal_app(env["root"], TOKEN, allowed_client_hosts=TEST_HOSTS, clock=clock.mono,
                              wall_clock=clock.now, research_file=env["research"], review_db=env["db"], **kw)
    return TestClient(app)


def login(client, env, who=None):
    assert client.post("/internal/session", headers=REVIEW, json={"token": TOKEN}).status_code == 204
    if who:
        ids = {"editor": "editor.a", "editor2": "editor.b", "rights": "rights.a", "location": "location.a"}
        r = client.post("/internal/session/reviewer", headers=REVIEW,
                        json={"reviewer_id": ids[who], "credential": env["creds"][who]})
        assert r.status_code == 204, r.text


def decide(client, clock, kind, sid, dtype, decision="approved", source_check="not_applicable", payload=None,
           rationale=RATIONALE, wait=10):
    t = client.post("/internal/review/tickets", headers=REVIEW,
                    json={"subject_kind": kind, "subject_id": sid, "decision_type": dtype})
    if t.status_code != 200:
        return t
    clock.advance(wait)
    return client.post("/internal/review/decisions", headers=REVIEW, json={
        "ticket_id": t.json()["ticket_id"], "decision": decision, "source_check": source_check,
        "rationale": rationale, "payload": payload or {}})


IDENTITY = {"display_name": "Test Eseri BUR-9001", "display_address": "Test Mahallesi, Test Caddesi",
            "identity_source_ids": ["S-9001-KP"], "acknowledged_discrepancy_ids": ["D-9001-01"]}
SOURCE_RIGHTS = {"rights_holder": "Test", "permission_reference": "IZIN-2026-1", "permitted_uses": ["citation"]}
VERIFY = {"candidate_id": "LC-9001-01", "method": "editor_map_review", "verification_reference": "Harita notu 1",
          "accuracy_m": 20, "acknowledged_discrepancy_ids": ["D-9001-01"]}
CHECKIN = {"latitude": 40.1841, "longitude": 29.0621, "radius_m": 40, "point_accuracy_m": 10,
           "point_kind": "public_square", "public_access_confirmed": True, "outside_worship_and_burial_areas": True,
           "access_hours_note": "Her gün", "safety_note": "Yaya alanı"}
PUBLISH = {"basis": "licensed_source", "title": "Test eseri yapım bilgisi",
           "public_text": "Kurgusal test eseri, editörün onayladığı bu metinle yayımlanır."}
QUIZ = {"question": "Test eserini kim yaptırdı?", "choices": ["Test Sultanı", "Başka biri"], "answer_index": 0,
        "explanation": "Kurgusal kaynak böyle yazar."}
IMAGE_RIGHTS = {"rights_holder": "Test Fotoğrafçı", "license": "CC-BY-4.0", "attribution": "© Test, CC BY 4.0",
                "monument_match": "confirmed"}


def status_of(client, kind, sid, dtype):
    return client.get(f"/internal/review/subjects/{kind}/{sid}", headers=REVIEW).json()["decisions"][dtype]


# --- Varsayılanlar ve kimlik --------------------------------------------------------


def test_everything_pending_by_default_even_when_quote_found(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env)
        overview = c.get("/internal/review/overview", headers=REVIEW).json()
        for dtype, counts in overview["counts"].items():
            assert counts["approved"] == 0, dtype
        # Kaynak sayfa denetiminde alıntı bulunmuş olgu da editör onayı almış sayılmaz.
        assert status_of(c, "fact", "BUR-9001-F001", "fact_editorial")["status"] == "pending"
        m = c.get("/internal/catalog/monuments/BUR-9001", headers=REVIEW).json()
        assert m["review"]["gates"]["facts_published"] == [] and m["review"]["gates"]["public"] is False
        assert m["map_eligible"] is False and m["checkin_eligible"] is False
        assert "kimliğini kanıtlamaz" in overview["identity_policy"]
        assert overview["rag_public_release"]["status"] == "blocked"


def test_shared_token_and_plain_session_cannot_record_decisions(env):
    clock = Clock()
    with make_client(env, clock) as c:
        body = {"subject_kind": "fact", "subject_id": "BUR-9001-F001", "decision_type": "fact_editorial"}
        assert c.post("/internal/review/tickets", headers={"X-Internal-Token": TOKEN}, json=body).status_code == 403
        login(c, env)
        assert c.post("/internal/review/tickets", headers=REVIEW, json=body).status_code == 403
        assert c.post("/internal/review/decisions", headers=REVIEW, json={
            "ticket_id": "x", "decision": "approved", "source_check": "verified_on_page", "rationale": RATIONALE,
        }).status_code == 403


def test_reviewer_login_rejects_wrong_credential_and_is_audited(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env)
        r = c.post("/internal/session/reviewer", headers=REVIEW, json={"reviewer_id": "editor.a", "credential": "x"})
        assert r.status_code == 401
        r = c.post("/internal/session/reviewer", headers=REVIEW,
                   json={"reviewer_id": "editor.a", "credential": env["creds"]["editor"]})
        assert r.status_code == 204
        assert c.get("/internal/session", headers=REVIEW).json()["reviewer"]["display_name"] == "Editör A"
        actions = [e["action"] for e in c.get("/internal/review/audit", headers=REVIEW).json()["entries"]]
        assert "reviewer_login_failed" in actions and "reviewer_login" in actions


def test_role_is_enforced(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "rights")
        r = decide(c, clock, "fact", "BUR-9001-F001", "fact_editorial", source_check="verified_on_page")
        assert r.status_code == 403
        login(c, env, "editor")
        r = decide(c, clock, "image", "BUR-9001/BUR-9001_test_1.jpeg", "image_rights", payload=IMAGE_RIGHTS)
        assert r.status_code == 403


# --- Toplu/sahte onay engelleri ------------------------------------------------------


def test_no_bulk_decisions(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        r = c.post("/internal/review/tickets", headers=REVIEW, json={
            "subject_kind": "fact", "subject_id": ["BUR-9001-F001", "BUR-9002-F001"], "decision_type": "fact_editorial"})
        assert r.status_code == 422
        r = c.post("/internal/review/tickets", headers=REVIEW, json=[
            {"subject_kind": "fact", "subject_id": "BUR-9001-F001", "decision_type": "fact_editorial"}])
        assert r.status_code == 422
        # Bilet olmadan veya uydurma biletle karar yok.
        r = c.post("/internal/review/decisions", headers=REVIEW, json={
            "ticket_id": "uydurma", "decision": "approved", "source_check": "verified_on_page", "rationale": RATIONALE})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "invalid_ticket"
        r = c.post("/internal/review/decisions", headers=REVIEW, json={
            "ticket_id": "x", "decision": "approved", "source_check": "verified_on_page", "rationale": RATIONALE,
            "subject_ids": ["BUR-9001-F001"]})
        assert r.status_code == 422


def test_ticket_is_single_use_and_requires_review_time(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        t = c.post("/internal/review/tickets", headers=REVIEW, json={
            "subject_kind": "fact", "subject_id": "BUR-9001-F001", "decision_type": "fact_editorial"}).json()
        body = {"ticket_id": t["ticket_id"], "decision": "approved", "source_check": "verified_on_page",
                "rationale": RATIONALE}
        clock.advance(1)
        r = c.post("/internal/review/decisions", headers=REVIEW, json=body)
        assert r.status_code == 429 and r.json()["detail"]["code"] == "review_too_fast"
        # Bilet ilk denemede tüketildi; aynı biletle tekrar denenemez.
        clock.advance(10)
        r = c.post("/internal/review/decisions", headers=REVIEW, json=body)
        assert r.json()["detail"]["code"] == "invalid_ticket"


@pytest.mark.parametrize("override, code", [
    ({"rationale": "tamam"}, "rationale_required"),
    ({"source_check": "not_checked"}, "source_check_required"),
    ({"source_check": "not_applicable"}, "source_check_required"),
])
def test_editorial_approval_requires_rationale_and_source_check(env, override, code):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        kw = {"source_check": "verified_on_page", **override}
        r = decide(c, clock, "fact", "BUR-9001-F001", "fact_editorial", **kw)
        assert r.status_code in (409, 422) and r.json()["detail"]["code"] == code


def test_rate_limit_blocks_mass_approval(env):
    clock = Clock()
    with make_client(env, clock, rate_limit=(2, 600)) as c:
        login(c, env, "editor")
        for fid in ("BUR-9001-F001", "BUR-9002-F001"):
            assert decide(c, clock, "fact", fid, "fact_editorial", source_check="verified_on_page").status_code == 201
        r = decide(c, clock, "draft", "DRAFT-BUR-9001-001", "draft_triage", decision="rejected")
        assert r.status_code == 429 and r.json()["detail"]["code"] == "rate_limited"


def test_concurrent_decision_invalidates_open_ticket(env):
    clock = Clock()
    with make_client(env, clock) as a, make_client(env, clock) as b:
        login(a, env, "editor")
        login(b, env, "editor2")
        body = {"subject_kind": "fact", "subject_id": "BUR-9001-F001", "decision_type": "fact_editorial"}
        ta = a.post("/internal/review/tickets", headers=REVIEW, json=body).json()
        assert decide(b, clock, "fact", "BUR-9001-F001", "fact_editorial", decision="needs_revision").status_code == 201
        r = a.post("/internal/review/decisions", headers=REVIEW, json={
            "ticket_id": ta["ticket_id"], "decision": "approved", "source_check": "verified_on_page",
            "rationale": RATIONALE})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "conflict"


# --- Olgular ve açık sorunlar -------------------------------------------------------


def test_fact_with_open_issue_needs_issue_resolution_first(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        r = decide(c, clock, "fact", "BUR-9001-F002", "fact_editorial", source_check="verified_on_page")
        assert r.status_code == 409 and "issue_unresolved:TEST-ISSUE-1" in r.json()["detail"]["message"]
        r = decide(c, clock, "issue", "TEST-ISSUE-1", "issue_resolution", source_check="verified_on_page",
                   payload={"resolution": "Kaynak yeniden okundu; 1700 tercih edildi.", "chosen_value": "1700"})
        assert r.status_code == 201
        r = decide(c, clock, "fact", "BUR-9001-F002", "fact_editorial", source_check="verified_with_discrepancy")
        assert r.status_code == 201


def test_each_fact_is_reviewed_separately_with_trace(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_editorial", source_check="verified_on_page").status_code == 201
        assert status_of(c, "fact", "BUR-9001-F001", "fact_editorial")["status"] == "approved"
        assert status_of(c, "fact", "BUR-9002-F001", "fact_editorial")["status"] == "pending"
        rec = status_of(c, "fact", "BUR-9001-F001", "fact_editorial")["decision"]
        assert rec["reviewer_name"] == "Editör A" and rec["reviewer_role"] == "editor"
        assert rec["data_version"].startswith("V20:") and rec["source_check"] == "verified_on_page"
        assert rec["rationale"] == RATIONALE and rec["reviewed_at"].startswith("2026-10-23T12:")


# --- Kalıcılık ve denetim ------------------------------------------------------------


def test_decisions_persist_and_audit_chain_detects_tampering(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_editorial", source_check="verified_on_page").status_code == 201
    with make_client(env, clock) as c:  # yeniden başlatma
        login(c, env)
        assert status_of(c, "fact", "BUR-9001-F001", "fact_editorial")["status"] == "approved"
        assert c.get("/internal/review/audit", headers=REVIEW).json()["verification"]["valid"] is True

    db = sqlite3.connect(env["db"])
    with pytest.raises(sqlite3.DatabaseError):
        db.execute("UPDATE decisions SET decision='rejected'")
    with pytest.raises(sqlite3.DatabaseError):
        db.execute("DELETE FROM audit_log")
    db.execute("INSERT INTO audit_log (at, actor, action, subject, details_json, prev_hash, entry_hash) "
               "VALUES ('x','x','x','x','{}','bad','bad')")
    db.commit()
    db.close()
    assert ReviewStore(env["db"]).verify_audit_chain()["valid"] is False


def test_concurrent_reads_share_one_connection_safely(tmp_path):
    # İnceleme ekranı karar durumlarını paralel ister; FastAPI bunları farklı iş parçacıklarında çalıştırır. Kilitsiz
    # okuma aynı bağlantıda sqlite3.InterfaceError / IndexError (HTTP 500) üretiyordu.
    store = ReviewStore(tmp_path / "review.sqlite3")
    store.add_reviewer("ed", "Editör", ("editor",), created_by="test")
    errors = []

    def read():
        try:
            for _ in range(200):
                store.history("monument", "BUR-9001")
                store.latest_all()
                assert store.reviewer("ed").roles == ("editor",)
                store.audit_entries(5)
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))

    threads = [threading.Thread(target=read) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert store.verify_audit_chain()["valid"] is True


def test_decision_goes_stale_when_data_version_changes(env, tmp_path):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_editorial", source_check="verified_on_page").status_code == 201
    kb_path = env["root"] / "v20" / "vakifname_knowledge_base_v20_dev.json"
    kb = json.loads(kb_path.read_text(encoding="utf-8"))
    kb["monuments"][0]["historical_facts"][0]["text"] = "DEĞİŞTİRİLMİŞ KURGUSAL OLGU"
    kb_path.write_text(json.dumps(kb, ensure_ascii=False), encoding="utf-8")
    freeze_path = env["root"] / "v20" / "vakifname_v20_freeze_manifest_v1_dev.json"
    freeze = json.loads(freeze_path.read_text())
    import hashlib
    freeze["base_database_sha256"] = hashlib.sha256(kb_path.read_bytes()).hexdigest()
    freeze_path.write_text(json.dumps(freeze))
    with make_client(env, clock) as c:
        login(c, env)
        s = status_of(c, "fact", "BUR-9001-F001", "fact_editorial")
        assert s["status"] == "pending" and s["stale"] is True


# --- Konum, harita ve check-in -------------------------------------------------------


def test_research_file_cannot_claim_verification(env):
    catalog = load_catalog(env["root"])
    for patch in ({"status": "verified"}, {"reviewed_by": "Biri"}, {"latitude": 0.0, "longitude": 0.0},
                  {"latitude": 29.06, "longitude": 40.18}):
        doc = research_doc()
        doc["monuments"][0]["location_candidates"][0].update(patch)
        with pytest.raises(CatalogError):
            load_research_dict(doc, catalog, env["tmp"])
    doc = research_doc()
    doc["policy"]["coordinates_verified_in_file"] = True
    with pytest.raises(CatalogError):
        load_research_dict(doc, catalog, env["tmp"])
    with pytest.raises(ValidationError):
        CoordinateCandidate(**{**_candidate("LC-9001-01", "S-9001-OSM"), "crs": "EPSG:3857"})


def load_research_dict(doc, catalog, tmp):
    p = tmp / "r.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    return load_research(p, catalog)


def test_unverified_candidate_is_not_mappable_and_missing_stays_missing(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env)
        a = c.get("/internal/catalog/monuments/BUR-9001", headers=REVIEW).json()
        b = c.get("/internal/catalog/monuments/BUR-9002", headers=REVIEW).json()
        assert a["location"]["status"] == "unverified" and a["map_eligible"] is False
        assert b["location"] == {**b["location"], "status": "missing", "latitude": None, "longitude": None}
        assert c.get("/internal/status", headers=REVIEW).json()["locations"] == {
            "missing": 1, "unverified": 1, "verified": 0}


def test_location_verification_needs_payload_and_source(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "location")
        r = decide(c, clock, "location", "BUR-9002", "location_verification",
                   payload={**VERIFY, "candidate_id": "LC-9002-01"})
        assert r.status_code == 409 and "no_coordinate_candidate" in r.json()["detail"]["message"]
        r = decide(c, clock, "location", "BUR-9001", "location_verification", payload={"candidate_id": "LC-9001-01"})
        assert r.status_code == 422
        r = decide(c, clock, "location", "BUR-9001", "location_verification",
                   payload={**VERIFY, "acknowledged_discrepancy_ids": []})
        assert r.status_code == 409 and "discrepancy_unacknowledged" in r.json()["detail"]["message"]
        r = decide(c, clock, "location", "BUR-9001", "location_verification", payload={**VERIFY, "accuracy_m": 2})
        assert "accuracy_better_than_source_requires_field_survey" in r.json()["detail"]["message"]
        assert decide(c, clock, "location", "BUR-9001", "location_verification", payload=VERIFY).status_code == 201
        loc = c.get("/internal/catalog/monuments/BUR-9001", headers=REVIEW).json()["location"]
        assert loc["status"] == "verified" and loc["verified_by"] == "Konum İncelemecisi"


def test_verified_map_location_does_not_grant_checkin(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        assert decide(c, clock, "monument", "BUR-9001", "catalog_identity", source_check="verified_on_page",
                      payload=IDENTITY).status_code == 201
        login(c, env, "location")
        r = decide(c, clock, "location", "BUR-9001", "location_map_display")
        assert r.status_code == 409 and "location_verification" in r.json()["detail"]["message"]
        assert decide(c, clock, "location", "BUR-9001", "location_verification", payload=VERIFY).status_code == 201
        assert decide(c, clock, "location", "BUR-9001", "location_map_display").status_code == 201
        m = c.get("/internal/catalog/monuments/BUR-9001", headers=REVIEW).json()
        assert m["map_eligible"] is True and m["checkin_eligible"] is False
        far = {**CHECKIN, "latitude": 40.20}
        r = decide(c, clock, "location", "BUR-9001", "gps_checkin", payload=far)
        assert r.status_code == 409 and "checkin_point_too_far_from_monument" in r.json()["detail"]["message"]
        bad = {**CHECKIN, "outside_worship_and_burial_areas": False}
        assert decide(c, clock, "location", "BUR-9001", "gps_checkin", payload=bad).status_code == 422
        small = {**CHECKIN, "radius_m": 5}
        assert decide(c, clock, "location", "BUR-9001", "gps_checkin", payload=small).status_code == 422
        assert decide(c, clock, "location", "BUR-9001", "gps_checkin", payload=CHECKIN).status_code == 201
        assert c.get("/internal/catalog/monuments/BUR-9001", headers=REVIEW).json()["checkin_eligible"] is True


# --- Temel kimlik: bağımsız yayın, kaynak ve telif ayrımı ---------------------------------


def test_identity_publishes_alone_without_fact_image_or_location_decisions(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        assert decide(c, clock, "monument", "BUR-9001", "catalog_identity", source_check="verified_on_page",
                      payload=IDENTITY).status_code == 201
        snapshot, media = build_snapshot(c.app.state.review)
    (m,) = snapshot.monuments
    assert (m.monument_id, m.name, m.address) == ("BUR-9001", "Test Eseri BUR-9001", "Test Mahallesi, Test Caddesi")
    assert m.facts == () and m.images == () and media == [] and m.location is None and m.checkin is None
    # Araştırmadaki otomatik derlenmiş erişim notu ve alternatif adlar editör seçmeden yayına geçmez.
    assert m.site_notice is None and m.alternative_names == ()


def test_identity_still_needs_explicit_decision_and_source_check(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        r = decide(c, clock, "monument", "BUR-9001", "catalog_identity", source_check="not_checked", payload=IDENTITY)
        assert r.json()["detail"]["code"] == "source_check_required"
        assert build_snapshot(c.app.state.review)[0].monuments == ()


@pytest.mark.parametrize("override, missing", [
    ({"display_name": "Uydurma Ad"}, "display_name_not_in_research"),
    ({"published_alternative_names": ["Uydurma"]}, "alternative_name_not_in_research:Uydurma"),
    ({"identity_source_ids": ["S-9001-OSM"]}, "identity_source_invalid:S-9001-OSM"),
    ({"identity_source_ids": ["S-9001-OSM"]}, "independent_identity_source_required"),
    ({"identity_source_ids": ["S-9001-PDF"]}, "independent_identity_source_required"),
    ({"identity_source_ids": ["S-9001-PDF"]}, "source_usage_rights:kaynak-a.pdf"),
    ({"display_address": "Kitap Mahallesi, Kaynak Sokak"}, "source_usage_rights:kaynak-a.pdf"),
])
def test_identity_source_and_rights_rules(env, override, missing):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        r = decide(c, clock, "monument", "BUR-9001", "catalog_identity", source_check="verified_on_page",
                   payload={**IDENTITY, **override})
        assert r.status_code == 409 and missing in r.json()["detail"]["message"]


def test_identity_from_source_book_requires_rights_and_falls_when_rights_revoked(env):
    clock = Clock()
    pdf_identity = {**IDENTITY, "identity_source_ids": ["S-9001-PDF"], "display_address": "Kitap Mahallesi, Kaynak Sokak",
                    "public_site_notice": "Ziyaret saatlerine uyunuz."}
    with make_client(env, clock) as c:
        login(c, env, "rights")
        assert decide(c, clock, "source", "kaynak-a.pdf", "source_usage_rights", payload=SOURCE_RIGHTS).status_code == 201
        login(c, env, "editor")
        assert decide(c, clock, "monument", "BUR-9001", "catalog_identity", source_check="verified_on_page",
                      payload=pdf_identity).status_code == 201
        (m,) = build_snapshot(c.app.state.review)[0].monuments
        assert m.address == "Kitap Mahallesi, Kaynak Sokak" and m.site_notice == "Ziyaret saatlerine uyunuz."
        login(c, env, "rights")
        assert decide(c, clock, "source", "kaynak-a.pdf", "source_usage_rights", decision="rejected").status_code == 201
        assert build_snapshot(c.app.state.review)[0].monuments == ()
        assert c.get("/internal/catalog/monuments/BUR-9001", headers=REVIEW).json()["review"]["gates"][
            "catalog_identity"] is False


# --- Koordinat adayları karşılaştırması --------------------------------------------------


def test_location_candidate_table_flags_uncertainty_and_never_verifies(env, tmp_path):
    doc = research_doc()
    m = doc["monuments"][0]
    m["sources"].append(_source("S-9001-OSMB", kind="open_map_data", supports=["location"]))
    m["location_candidates"].append(_candidate("LC-9001-02", "S-9001-OSMB", lat=40.1842, lon=29.0619,
                                               represents="area_centroid"))
    m["discrepancies"].append({"discrepancy_id": "D-9001-02", "topic": "Hangi yapı", "description": "Kurgusal.",
                               "source_ids": ["S-9001-OSM", "S-9001-OSMB"]})
    env["research"].write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env)
        body = c.get("/internal/review/location-candidates", headers=REVIEW).json()
    rows = {r["candidate_id"]: r for r in body["candidates"]}
    assert set(rows) == {"LC-9001-01", "LC-9001-02"}
    assert body["verified"] == 0 and body["entry_points_available"] == 0
    a, b = rows["LC-9001-01"], rows["LC-9001-02"]
    assert a["competing_discrepancy_ids"] == b["competing_discrepancy_ids"] == ["D-9001-02"]
    assert {"competing_candidate", "centroid_not_entrance", "candidates_disagree", "worship_site"} <= set(a["flags"])
    assert "area_not_building" in b["flags"] and a["other_candidates"][0]["distance_m"] > 30
    assert all(r["status"] == "unverified" and r["checkin_entry_point"] is None for r in rows.values())


# --- Yayın ---------------------------------------------------------------------------


def approve_chain(c, env, clock, *, publish_fact=True, image=False, location=False):
    login(c, env, "editor")
    assert decide(c, clock, "monument", "BUR-9001", "catalog_identity", source_check="verified_on_page",
                  payload=IDENTITY).status_code == 201
    assert decide(c, clock, "fact", "BUR-9001-F001", "fact_editorial", source_check="verified_on_page").status_code == 201
    login(c, env, "rights")
    assert decide(c, clock, "source", "kaynak-a.pdf", "source_usage_rights", payload=SOURCE_RIGHTS).status_code == 201
    if image:
        img = "BUR-9001/BUR-9001_test_1.jpeg"
        assert decide(c, clock, "image", img, "image_rights", payload=IMAGE_RIGHTS).status_code == 201
        assert decide(c, clock, "image", img, "image_publication").status_code == 201
    if publish_fact:
        login(c, env, "editor")
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_publication", payload=PUBLISH).status_code == 201
    if location:
        login(c, env, "location")
        assert decide(c, clock, "location", "BUR-9001", "location_verification", payload=VERIFY).status_code == 201
        assert decide(c, clock, "location", "BUR-9001", "location_map_display").status_code == 201


def test_editor_approval_alone_does_not_publish_fact(env):
    clock = Clock()
    with make_client(env, clock) as c:
        approve_chain(c, env, clock, publish_fact=False)
        snapshot, _ = build_snapshot(c.app.state.review)
    (m,) = snapshot.monuments
    assert m.facts == () and m.location is None and m.checkin is None


def test_publication_chain_breaks_when_link_is_revoked(env):
    clock = Clock()
    with make_client(env, clock) as c:
        approve_chain(c, env, clock)
        assert [f.fact_id for f in build_snapshot(c.app.state.review)[0].monuments[0].facts] == ["BUR-9001-F001"]
        login(c, env, "editor")
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_editorial", decision="rejected").status_code == 201
        assert build_snapshot(c.app.state.review)[0].monuments[0].facts == ()


def test_game_use_is_separate_from_publication(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "editor")
        r = decide(c, clock, "fact", "BUR-9001-F001", "fact_game_use", payload=QUIZ)
        assert r.status_code == 409 and "fact_publication" in r.json()["detail"]["message"]
        approve_chain(c, env, clock)
        (fact,) = build_snapshot(c.app.state.review)[0].monuments[0].facts
        assert fact.game_use is False
        login(c, env, "editor")
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_game_use").status_code == 422  # soru zorunlu
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_game_use", payload=QUIZ).status_code == 201
        (fact,) = build_snapshot(c.app.state.review)[0].monuments[0].facts
        assert fact.game_use is True and fact.game_use_decision_id
        assert fact.quest.question == QUIZ["question"] and fact.quest.answer_index == 0


def test_image_publication_requires_rights_record(env):
    clock = Clock()
    with make_client(env, clock) as c:
        login(c, env, "rights")
        img = "BUR-9001/BUR-9001_test_1.jpeg"
        r = decide(c, clock, "image", img, "image_publication")
        assert r.status_code == 409 and "image_rights" in r.json()["detail"]["message"]
        no_attr = {**IMAGE_RIGHTS, "attribution": None}
        assert decide(c, clock, "image", img, "image_rights", payload=no_attr).status_code == 422
        unknown = {**IMAGE_RIGHTS, "license": "unknown"}
        assert decide(c, clock, "image", img, "image_rights", payload=unknown).status_code == 422


def test_public_api_serves_only_exported_approved_content(env, tmp_path):
    clock = Clock()
    with make_client(env, clock) as c:
        approve_chain(c, env, clock, location=True)
        service = c.app.state.review
        out = tmp_path / "public" / "catalog.json"
        write_snapshot(service, out, env["root"] / "images" / "monuments", actor="test")
        texts = {f.fact_id: f.text for f in service.catalog.facts.values()}
        quotes = {f.source.evidence_quote for f in service.catalog.facts.values()}
        drafts = {d.statement for d in service.catalog.drafts.values()}
    with TestClient(create_app(TEST_PLACES_FILE, cors_origins=DEFAULT_CORS_ORIGINS, public_catalog_file=out)) as pub:
        listing = pub.get("/monuments").json()
        assert listing["published_count"] == 1
        (m,) = listing["monuments"]
        assert m["monument_id"] == "BUR-9001" and m["location"]["latitude"] == 40.1839
        assert m["checkin_available"] is False
        detail = pub.get("/monuments/BUR-9001").json()
        assert [f["fact_id"] for f in detail["facts"]] == ["BUR-9001-F001"]
        assert pub.get("/monuments/BUR-9002").status_code == 404
        r = pub.post("/monuments/BUR-9001/check-in", json={"user_id": "u", "latitude": 40.1839, "longitude": 29.0619})
        assert r.status_code == 409
        blob = "\n".join(pub.get(p).text for p in ("/monuments", "/monuments/BUR-9001", "/openapi.json"))
    assert texts["BUR-9001-F002"] not in blob and texts["BUR-9002-F001"] not in blob
    assert not [q for q in quotes if q in blob] and not [d for d in drafts if d in blob]
    assert "rationale" not in blob and "Editör A" not in blob
