"""PR #1 incelemesindeki M1, M2, M3 ve D1 bulguları için regresyon testleri."""

import math
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.geo import EARTH_RADIUS_M, haversine_m
from app.main import DEFAULT_CORS_ORIGINS, cors_origins_from_env, create_app
from app.models import Place
from app.services import ProgressStore, check_in

TEST_PLACES_FILE = Path(__file__).parent / "data" / "places.json"


def post_raw(client, body, place_id="test-a"):
    return client.post(f"/quests/{place_id}/check-in", content=body, headers={"Content-Type": "application/json"})


def stamps(client, user_id):
    return client.get(f"/users/{user_id}/passport").json()["total_stamps"]


def lat_at_distance(meters):
    """(0, 0) noktasından kuzeye `meters` uzaklıktaki enlem."""
    return math.degrees(meters / EARTH_RADIUS_M)


# --- M1: NaN / Infinity -----------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        '{"user_id":"x","latitude":NaN,"longitude":0}',
        '{"user_id":"x","latitude":0,"longitude":NaN}',
        '{"user_id":"x","latitude":Infinity,"longitude":0}',
        '{"user_id":"x","latitude":0,"longitude":-Infinity}',
        '{"user_id":"x","latitude":1e999,"longitude":0}',  # float'a sığmaz, inf olur
    ],
)
def test_non_finite_coordinates_return_422(client, body):
    r = post_raw(client, body)
    assert r.status_code == 422
    errors = r.json()["detail"]
    assert errors and all("input" not in e for e in errors)
    assert stamps(client, "x") == 0


def test_invalid_json_number_returns_422(client):
    assert post_raw(client, '{"user_id":"x","latitude":+1,"longitude":0}').status_code == 422


def test_ordinary_validation_errors_still_echo_input(client):
    r = client.post("/quests/test-a/check-in", json={"user_id": "x", "latitude": 95, "longitude": 0})
    assert r.status_code == 422
    assert r.json()["detail"][0]["input"] == 95


def test_valid_coordinates_still_accepted(client):
    r = client.post("/quests/test-a/check-in", json={"user_id": "x", "latitude": 0.0001, "longitude": -0.0001})
    assert r.json()["status"] == "completed"


# --- M2: path parametreleri -------------------------------------------------


@pytest.mark.parametrize("user_id", ["%20%20", "a" * 65])
def test_invalid_path_user_id_rejected(client, user_id):
    assert client.get(f"/users/{user_id}/passport").status_code == 422


def test_max_length_path_user_id_accepted(client):
    assert client.get(f"/users/{'a' * 64}/passport").status_code == 200


def test_invalid_path_place_id_rejected(client):
    assert client.get(f"/places/{'a' * 65}").status_code == 422
    assert post_raw(client, '{"user_id":"x","latitude":0,"longitude":0}', place_id="%20").status_code == 422


def test_body_and_path_user_id_normalized_the_same(client):
    client.post("/quests/test-a/check-in", json={"user_id": "  ayse ", "latitude": 0, "longitude": 0})
    r = client.get("/users/%20ayse%20/passport")
    assert r.status_code == 200
    assert r.json()["user_id"] == "ayse"
    assert r.json()["total_stamps"] == 1
    assert stamps(client, "ayse") == 1


def test_path_constraints_in_openapi(client):
    params = client.get("/openapi.json").json()["paths"]["/users/{user_id}/passport"]["get"]["parameters"]
    assert params[0]["schema"]["minLength"] == 1
    assert params[0]["schema"]["maxLength"] == 64


# --- M3: CORS ---------------------------------------------------------------

ALLOWED = "http://localhost:5173"
BLOCKED = "https://evil.example"


def test_cors_preflight_allowed_origin(client):
    r = client.options(
        "/quests/test-a/check-in",
        headers={"Origin": ALLOWED, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == ALLOWED
    assert "POST" in r.headers["access-control-allow-methods"]


def test_cors_get_allowed_origin(client):
    r = client.get("/places", headers={"Origin": ALLOWED})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == ALLOWED


def test_cors_blocked_origin_gets_no_permission(client):
    preflight = client.options("/places", headers={"Origin": BLOCKED, "Access-Control-Request-Method": "GET"})
    assert preflight.status_code == 400
    assert "access-control-allow-origin" not in preflight.headers
    assert "access-control-allow-origin" not in client.get("/places", headers={"Origin": BLOCKED}).headers


def test_cors_requires_exact_origin_match(client):
    for origin in ["http://localhost:5174", "http://localhost:5173.evil.example", "https://localhost:5173"]:
        assert "access-control-allow-origin" not in client.get("/places", headers={"Origin": origin}).headers


def test_cors_default_origins(monkeypatch):
    monkeypatch.delenv("VAKIFNAME_CORS_ORIGINS", raising=False)
    assert cors_origins_from_env() == DEFAULT_CORS_ORIGINS


def test_cors_origins_from_env(monkeypatch):
    monkeypatch.setenv("VAKIFNAME_CORS_ORIGINS", " https://app.example/ , https://admin.example ")
    assert cors_origins_from_env() == ["https://app.example", "https://admin.example"]
    with TestClient(create_app(TEST_PLACES_FILE)) as c:
        assert c.get("/places", headers={"Origin": "https://app.example"}).headers["access-control-allow-origin"] == "https://app.example"
        assert "access-control-allow-origin" not in c.get("/places", headers={"Origin": ALLOWED}).headers


def test_cors_wildcard_rejected(monkeypatch):
    monkeypatch.setenv("VAKIFNAME_CORS_ORIGINS", "https://app.example,*")
    with pytest.raises(ValueError, match=r"\*"):
        cors_origins_from_env()


# --- D1: yarıçap sınırı -----------------------------------------------------


def _place(radius):
    return Place(id="p", name="P", city="C", description="", latitude=0, longitude=0, check_in_radius_m=radius, is_demo=True)


def test_exact_boundary_completes():
    lat = lat_at_distance(100)
    place = _place(haversine_m(lat, 0, 0, 0))  # yarıçap tam olarak hesaplanan mesafe
    assert check_in(place, "u", lat, 0, ProgressStore()).status == "completed"


def test_just_inside_boundary_completes(client):
    r = client.post("/quests/test-a/check-in", json={"user_id": "u", "latitude": lat_at_distance(99.96), "longitude": 0})
    assert r.json()["status"] == "completed"


def test_just_outside_boundary_fails(client):
    # 100.04 m eskiden 100.0'a yuvarlanıp kabul ediliyordu.
    r = client.post("/quests/test-a/check-in", json={"user_id": "u", "latitude": lat_at_distance(100.04), "longitude": 0})
    body = r.json()
    assert body["status"] == "out_of_range"
    assert body["stamp"] is None
    assert body["distance_m"] == 100.0  # gösterim yuvarlanabilir, karar yuvarlanmamış değerle verilir
    assert stamps(client, "u") == 0
