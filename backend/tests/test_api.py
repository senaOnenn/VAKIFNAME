import json

import pytest
from pydantic import ValidationError

from app.geo import haversine_m
from app.services import PlaceRepository

# test-a (0, 0) yarıçap 100 m; 0.0005° enlem ≈ 55.6 m
IN_RANGE = {"latitude": 0.0005, "longitude": 0.0}
OUT_OF_RANGE = {"latitude": 0.01, "longitude": 0.0}  # ≈ 1112 m


def check_in(client, place_id="test-a", user_id="ayse", **coords):
    return client.post(f"/quests/{place_id}/check-in", json={"user_id": user_id, **(coords or IN_RANGE)})


def test_root(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_list_places(client):
    r = client.get("/places")
    assert r.status_code == 200
    assert [p["id"] for p in r.json()] == ["test-a", "test-b"]


def test_get_place(client):
    r = client.get("/places/test-b")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Test Mekânı B"
    assert body["is_demo"] is True
    assert body["source_url"] == "https://example.org/kaynak"


def test_get_place_not_found(client):
    r = client.get("/places/yok")
    assert r.status_code == 404
    assert "bulunamadı" in r.json()["detail"]


def test_check_in_in_range(client):
    r = check_in(client)
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["status"] == "completed"
    assert 50 < body["distance_m"] < 60
    assert body["stamp"]["place_id"] == "test-a"


def test_check_in_out_of_range(client):
    r = check_in(client, **OUT_OF_RANGE)
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is False
    assert body["status"] == "out_of_range"
    assert body["distance_m"] > body["allowed_radius_m"]
    assert body["stamp"] is None
    assert client.get("/users/ayse/passport").json()["total_stamps"] == 0


def test_check_in_unknown_place(client):
    assert check_in(client, place_id="yok").status_code == 404


def test_check_in_adds_stamp_to_passport(client):
    check_in(client)
    r = client.get("/users/ayse/passport")
    assert r.status_code == 200
    body = r.json()
    assert body["total_stamps"] == 1
    assert body["stamps"][0]["place_id"] == "test-a"


def test_repeat_check_in_does_not_duplicate_stamp(client):
    first = check_in(client).json()
    second = check_in(client).json()
    assert second["success"] is True
    assert second["status"] == "already_completed"
    assert second["stamp"] == first["stamp"]
    assert client.get("/users/ayse/passport").json()["total_stamps"] == 1


def test_stamps_are_per_user(client):
    check_in(client, user_id="ayse")
    assert client.get("/users/mehmet/passport").json()["total_stamps"] == 0


@pytest.mark.parametrize(
    "payload",
    [
        {"user_id": "ayse", "latitude": 91, "longitude": 0},
        {"user_id": "ayse", "latitude": -91, "longitude": 0},
        {"user_id": "ayse", "latitude": 0, "longitude": 181},
        {"user_id": "ayse", "latitude": 0, "longitude": -181},
        {"user_id": "ayse", "latitude": "abc", "longitude": 0},
        {"user_id": "", "latitude": 0, "longitude": 0},
        {"latitude": 0, "longitude": 0},
    ],
)
def test_check_in_validation_errors(client, payload):
    assert client.post("/quests/test-a/check-in", json=payload).status_code == 422


@pytest.mark.parametrize("_run", [1, 2])
def test_state_is_isolated_between_tests(client, _run):
    # İki kez çalışır; önceki testlerin mühürleri görünmemeli.
    assert client.get("/users/ayse/passport").json()["total_stamps"] == 0
    assert check_in(client).json()["status"] == "completed"


def test_haversine_known_distance():
    # Ekvatorda 1° boylam ≈ 111.195 km
    assert haversine_m(0, 0, 0, 1) == pytest.approx(111_195, rel=1e-3)
    assert haversine_m(41.0, 29.0, 41.0, 29.0) == 0


def _write(tmp_path, places):
    f = tmp_path / "places.json"
    f.write_text(json.dumps(places), encoding="utf-8")
    return f


def _place(**overrides):
    base = {"id": "x", "name": "X", "city": "Y", "description": "", "latitude": 0, "longitude": 0,
            "check_in_radius_m": 10, "is_demo": True}
    return {**base, **overrides}


@pytest.mark.parametrize("bad", [{"check_in_radius_m": -5}, {"check_in_radius_m": 0}, {"latitude": 100}])
def test_repository_rejects_invalid_place(tmp_path, bad):
    with pytest.raises(ValidationError):
        PlaceRepository(_write(tmp_path, [_place(**bad)]))


def test_repository_rejects_duplicate_ids(tmp_path):
    with pytest.raises(ValueError, match="Yinelenen"):
        PlaceRepository(_write(tmp_path, [_place(), _place()]))


def test_default_dataset_is_demo_only():
    from app.main import DEFAULT_PLACES_FILE

    places = PlaceRepository(DEFAULT_PLACES_FILE).list()
    assert places and all(p.is_demo for p in places)
