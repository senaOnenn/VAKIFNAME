"""Dahili API erişim kontrolü ve genel API'den yalıtım."""

import secrets
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.internal.server import create_internal_app
from app.main import DEFAULT_CORS_ORIGINS, DEFAULT_PLACES_FILE, create_app
from tests.internal_fixtures import write_data_dir

REPO_ROOT = Path(__file__).resolve().parents[2]
TOKEN = secrets.token_urlsafe(32)
AUTH = {"X-Internal-Token": TOKEN}
# TestClient istemci adresi "testclient"tır; loopback yerine bunu izinli sayarak erişim kontrolünü test ediyoruz.
TEST_HOSTS = frozenset({"testclient"})


@pytest.fixture
def data_dir(tmp_path):
    return write_data_dir(tmp_path / "internal")


@pytest.fixture
def internal(data_dir):
    with TestClient(create_internal_app(data_dir, TOKEN, allowed_client_hosts=TEST_HOSTS)) as c:
        yield c


def test_short_token_refused(data_dir):
    for bad in ("", "kisa", None):
        with pytest.raises(ValueError):
            create_internal_app(data_dir, bad)


def test_non_loopback_client_rejected(data_dir):
    # Varsayılan ayar yalnızca 127.0.0.1 / ::1; TestClient'ın adresi bunlardan değil.
    with TestClient(create_internal_app(data_dir, TOKEN)) as c:
        assert c.get("/internal/status", headers=AUTH).status_code == 403
        assert c.post("/internal/rag/ask", headers=AUTH, json={"question": "x"}).status_code == 403


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/internal/status"),
        ("get", "/internal/catalog/monuments"),
        ("get", "/internal/catalog/monuments/BUR-9001"),
        ("get", "/internal/catalog/facts/BUR-9001-F001"),
        ("get", "/internal/catalog/issues"),
        ("get", "/internal/catalog/drafts"),
        ("get", "/internal/catalog/images"),
        ("post", "/internal/rag/ask"),
    ],
)
@pytest.mark.parametrize("headers", [{}, {"X-Internal-Token": "yanlis"}, {"X-Internal-Token": TOKEN + "x"}])
def test_unauthorized_requests_rejected(internal, method, path, headers):
    r = getattr(internal, method)(path, headers=headers, **({"json": {"question": "x"}} if method == "post" else {}))
    assert r.status_code == 401


def test_docs_and_openapi_disabled(internal):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert internal.get(path, headers=AUTH).status_code == 404


def test_internal_status_reports_closed_access(internal):
    body = internal.get("/internal/status", headers=AUTH).json()
    assert body["public_access"] is False
    assert body["publicly_usable_facts"] == 0
    assert body["publishable_images"] == 0
    assert body["access_policy"]["publication_status"] == "blocked"


def test_internal_monument_has_null_location(internal):
    m = internal.get("/internal/catalog/monuments/BUR-9001", headers=AUTH).json()
    assert m["location"]["latitude"] is None and m["location"]["longitude"] is None
    assert m["location"]["status"] == "missing" and m["checkin_eligible"] is False and m["map_eligible"] is False
    assert m["facts"][0]["source"]["pdf_page_kind"] == "physical"
    assert "facts" in m and "drafts" not in m


def test_drafts_are_marked_quarantined(internal):
    body = internal.get("/internal/catalog/drafts", headers=AUTH).json()
    assert body["quarantined"] is True
    assert all(d["rag_eligible"] is False for d in body["drafts"])


def test_images_endpoint_serves_metadata_only(internal):
    body = internal.get("/internal/catalog/images", headers=AUTH).json()
    assert body["files_served"] is False
    assert all(i["public_serving_allowed"] is False for i in body["images"])
    r = internal.get("/internal/catalog/images/BUR-9001/BUR-9001_test_1.jpeg", headers=AUTH)
    assert r.status_code == 404


def test_rag_unavailable_returns_503_without_package(internal):
    # Kurgusal veri dizininde RAG paketi yok: cevap uydurulmaz, 503 döner.
    r = internal.post("/internal/rag/ask", headers=AUTH, json={"question": "Test Eser BUR-9001 kim yaptırdı?"})
    assert r.status_code == 503


@pytest.mark.parametrize("question", ["", "x" * 501])
def test_rag_question_validation(internal, question):
    assert internal.post("/internal/rag/ask", headers=AUTH, json={"question": question}).status_code == 422


# --- Genel API yalıtımı -------------------------------------------------------------


@pytest.fixture
def public_client():
    with TestClient(create_app(DEFAULT_PLACES_FILE, cors_origins=DEFAULT_CORS_ORIGINS, demo_api=True)) as c:
        yield c


def test_public_app_has_no_internal_routes(public_client):
    paths = public_client.get("/openapi.json").json()["paths"]
    assert not [p for p in paths if p.startswith("/internal")]
    assert public_client.get("/internal/status", headers=AUTH).status_code == 404


def test_public_places_contain_only_demo_records(public_client):
    places = public_client.get("/places").json()
    assert {p["id"] for p in places} == {"demo-mekan-a", "demo-mekan-b", "demo-mekan-c"}
    assert all(p["is_demo"] for p in places)
    assert "BUR-" not in public_client.get("/places").text


def test_real_monument_not_available_for_public_check_in(public_client):
    r = public_client.post("/quests/BUR-0001/check-in", json={"user_id": "u", "latitude": 40.18, "longitude": 29.06})
    assert r.status_code == 404
    assert public_client.get("/places/BUR-0020").status_code == 404


def test_frontend_contains_no_internal_data():
    frontend = REPO_ROOT / "frontend"
    forbidden_suffixes = {".pdf", ".jpeg", ".jpg", ".index", ".zip"}
    for folder in (frontend / "public", frontend / "src"):
        for path in folder.rglob("*"):
            if not path.is_file():
                continue
            assert path.suffix.lower() not in forbidden_suffixes, path
            text = path.read_text(encoding="utf-8", errors="ignore")
            assert "X-Internal-Token" not in text, path
            assert "VAKIFNAME_INTERNAL" not in text, path
            assert "BUR-00" not in text, path


def test_token_is_read_from_private_file_in_preference_to_env(tmp_path, monkeypatch):
    import os

    from app.internal import config

    f = tmp_path / "internal_token"
    f.write_text(TOKEN + "\n")
    os.chmod(f, 0o600)
    monkeypatch.setenv("VAKIFNAME_INTERNAL_TOKEN", "eski-ortam-anahtari")
    monkeypatch.setenv("VAKIFNAME_INTERNAL_TOKEN_FILE", str(f))
    assert config.token_from_env() == TOKEN
    os.chmod(f, 0o640)
    with pytest.raises(ValueError, match="600"):
        config.token_from_env()
    monkeypatch.delenv("VAKIFNAME_INTERNAL_TOKEN_FILE")
    assert config.token_from_env() == "eski-ortam-anahtari"
