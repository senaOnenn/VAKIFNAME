"""Rota motoru ve `/route` ucu: başlangıç noktası önceliği (30 km kuralı), en yakın komşu sırası ve eşitlikte kimlik
sırası, kilit sınırının doldurulması (ilk 3, her bilgi mührü bir kilit), açılan kilidin kalıcılığı, şehir kısa adı,
erişim denetimi, misafir→hesap birleştirme ve hesap silmede kilitler."""

import json
import random
import uuid
from pathlib import Path

import pytest
from tests.players import PlayerClient as TestClient, new_player

from app.geo import haversine_m
from app.main import create_app
from app.progress import MonumentProgressStore
from app.route_engine import (
    Completion, Point, Start, choose_start, city_center, city_slug, frontier_top_up, greedy_tour, plan_route,
)

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
CATALOG = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
COORDS = {m["monument_id"]: (m["location"]["latitude"], m["location"]["longitude"]) for m in CATALOG["monuments"]}
NAMES = {m["monument_id"]: m["name"] for m in CATALOG["monuments"]}
MURADIYE = ("BUR-0003", "BUR-0005", "BUR-0007", "BUR-0008")
ISTANBUL = (41.0082, 28.9784)  # Bursa merkezine ~91 km
PASSWORD = "Gizli-Parola-42"
DEC = "DEC-" + "a" * 16


def visitor(c) -> str:
    """Yeni oyuncu hesabı (R6.2: oyun yalnızca hesapla; bkz. tests/players.py)."""
    return new_player(c)


def guest_id() -> str:
    return f"ziyaretci-{uuid.uuid4()}"


def dist(a: tuple[float, float], mid: str) -> float:
    return haversine_m(*a, *COORDS[mid])


def nearest(a: tuple[float, float], ids, k: int) -> list[str]:
    """Bağımsız kaba kuvvet: `a`'ya en yakın `k` eser (eşitlikte kimlik)."""
    return sorted(ids, key=lambda m: (dist(a, m), m))[:k]


def answers(monument_id: str) -> list[tuple[str, int]]:
    (m,) = [m for m in CATALOG["monuments"] if m["monument_id"] == monument_id]
    return [(f["fact_id"], f["quest"]["answer_index"]) for f in m["facts"] if f.get("quest")]


def earn_knowledge_seal(c, user_id: str, monument_id: str):
    for quest_id, idx in answers(monument_id):
        r = c.post(f"/monuments/{monument_id}/quests/{quest_id}/answer", json={"user_id": user_id, "choice_index": idx})
        assert r.status_code == 200, r.text
    assert r.json()["knowledge_seal"] is not None


def seal(c, user_id: str, monument_id: str, kind: str = "knowledge"):
    c.app.state.monument_progress.add_seal(user_id, monument_id, NAMES[monument_id], kind)


def route(c, user_id: str, city: str = "bursa", at: tuple[float, float] | None = None):
    params = {"city": city, "user_id": user_id}
    if at is not None:
        params.update(lat=at[0], lng=at[1])
    r = c.get("/route", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def open_ids(body: dict) -> set[str]:
    """Açık ve tamamlanmamış eserler."""
    return {s["monument_id"] for s in body["stops"] if s["state"] == "unlocked"}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("VAKIFNAME_PROGRESS_DB", "VAKIFNAME_ACCOUNTS_DB", "VAKIFNAME_AUTH_RATE", "VAKIFNAME_GOOGLE_CLIENT_ID",
                 "VAKIFNAME_COOKIE_SECURE"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def c():
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False)) as client:
        yield client


# --- Saf motor ---------------------------------------------------------------------------------------------------

def P(mid: str, lat: float, lng: float = 29.0) -> Point:
    return Point(mid, mid, "cami", lat, lng)


@pytest.mark.parametrize("name, slug", [
    ("Bursa", "bursa"), ("BURSA", "bursa"), (" bursa ", "bursa"), ("İzmir", "izmir"), ("İZMİR", "izmir"),
    ("Kütahya", "kutahya"), ("MUĞLA", "mugla"), ("Çanakkale", "canakkale"), ("Iğdır", "igdir"), ("IĞDIR", "igdir"),
    ("Şanlıurfa", "sanliurfa"), ("ŞANLIURFA", "sanliurfa"), ("Gümüşhane", "gumushane"), ("Eskişehir", "eskisehir"),
    ("Ordu", "ordu"), ("Kütahya".replace("ü", "ü"), "kutahya"), ("İzmir", "izmir"), ("", ""),
])
def test_city_slug_folds_turkish_letters(name, slug):
    assert city_slug(name) == slug


def test_greedy_tour_is_nearest_neighbour_not_a_distance_sort():
    a, b, d = P("BUR-0002", 40.001), P("BUR-0003", 40.003), P("BUR-0001", 39.9975)
    # Uzaklığa göre sıralama A, D, B olurdu; en yakın komşu A'dan sonra B'ye (222 m) gider, D (389 m) sona kalır.
    for perm in ([a, b, d], [d, b, a], [b, d, a]):
        assert [p.monument_id for p in greedy_tour(40.0, 29.0, perm)] == ["BUR-0002", "BUR-0003", "BUR-0001"]
    assert greedy_tour(40.0, 29.0, []) == []


def test_exact_distance_ties_are_broken_by_monument_id():
    step = 2 ** -10  # ikilik kesir: iki yan nokta başlangıca tam olarak eşit uzaklıkta
    east, west = P("BUR-0009", 40.0, 29.0 + step), P("BUR-0004", 40.0, 29.0 - step)
    assert haversine_m(40.0, 29.0, east.latitude, east.longitude) == haversine_m(40.0, 29.0, west.latitude, west.longitude)
    for perm in ([east, west], [west, east]):
        assert [p.monument_id for p in greedy_tour(40.0, 29.0, perm)] == ["BUR-0004", "BUR-0009"]
    # Aynı koordinattaki iki eser (aynı külliye) de kimlik sırasıyla gelir.
    twin_a, twin_b = P("BUR-0007", 40.002), P("BUR-0006", 40.002)
    assert [p.monument_id for p in greedy_tour(40.0, 29.0, [twin_a, twin_b])] == ["BUR-0006", "BUR-0007"]
    assert frontier_top_up(Start("user", 40.0, 29.0), [east, west], set(), set(), size=1) == ["BUR-0004"]


def test_muradiye_cluster_order_is_deterministic():
    points = [Point(m, NAMES[m], "cami", *COORDS[m]) for m in COORDS]
    cluster = city_center([p for p in points if p.monument_id in MURADIYE])
    rng = random.Random(42)
    orders = set()
    for _ in range(20):
        shuffled = points[:]
        rng.shuffle(shuffled)
        orders.add(tuple(s.point.monument_id for s in plan_route(shuffled, [], set(), cluster).stops))
    (order,) = orders
    assert set(order[:4]) == set(MURADIYE)  # dört eser 100 m içinde; tur önce onları bitirir


def test_start_point_priority_and_30_km_rule():
    points = [P("BUR-0001", 40.0), P("BUR-0002", 40.002), P("BUR-0003", 40.004)]
    center = city_center(points)
    assert center == pytest.approx((40.002, 29.0))
    inside, outside = (40.002 + 0.2690, 29.0), (40.002 + 0.2700, 29.0)
    assert haversine_m(*center, *inside) < 30_000 < haversine_m(*center, *outside)

    assert choose_start(points, [], inside) == Start("user", *inside)
    assert choose_start(points, [], outside).source == "city_center"
    assert choose_start(points, [], None) == Start("city_center", *center)
    # En son tamamlanan (liste en yeni önce); başka şehirdeki eser atlanır.
    done = [Completion("IZM-0001", "2026-10-27T10:05:00+00:00", False),
            Completion("BUR-0003", "2026-10-27T10:04:00+00:00", False),
            Completion("BUR-0001", "2026-10-27T10:00:00+00:00", True)]
    assert choose_start(points, done, outside) == Start("last_completed", 40.004, 29.0)
    assert choose_start(points, done, None).source == "last_completed"
    assert choose_start(points, done, inside).source == "user"  # konum her zaman önce gelir
    assert choose_start(points, done[:1], None).source == "city_center"


def test_frontier_top_up_keeps_three_open_and_never_locks():
    points = [P(f"BUR-000{i}", 40.0 + i * 0.001) for i in range(1, 7)]  # başlangıçtan uzaklaşan sıra
    start = Start("city_center", 40.0, 29.0)
    assert frontier_top_up(start, points, set(), set()) == ["BUR-0001", "BUR-0002", "BUR-0003"]
    assert frontier_top_up(start, points, set(), {"BUR-0001", "BUR-0002", "BUR-0003"}) == []
    # Bir tanesi tamamlandı: bir kilit açılır, en yakın kilitli olan.
    assert frontier_top_up(start, points, {"BUR-0002"}, {"BUR-0001", "BUR-0002", "BUR-0003"}) == ["BUR-0004"]
    # Taşmış sınır (birleştirme sonrası) hiçbir eseri kilitlemez.
    assert frontier_top_up(start, points, set(), {p.monument_id for p in points[:5]}) == []
    # Açılmadan tamamlanan eser de tamamlanmış sayılır; sınır yine 3 açık esere tamamlanır.
    assert frontier_top_up(start, points, {"BUR-0006"}, set()) == ["BUR-0001", "BUR-0002", "BUR-0003"]
    # Kalan 3'ten azsa hepsi açılır.
    done = {"BUR-0001", "BUR-0002", "BUR-0003", "BUR-0004"}
    assert frontier_top_up(start, points, done, done) == ["BUR-0005", "BUR-0006"]


def test_plan_next_is_first_unlocked_stop_and_completed_are_not_stops():
    points = [P(f"BUR-000{i}", 40.0 + i * 0.001) for i in range(1, 7)]
    # Önceden uzakta açılmış üç eser; kullanıcı şimdi başlangıçta: yakındakiler kilitli kalır.
    plan = plan_route(points, [], {"BUR-0004", "BUR-0005", "BUR-0006"}, (40.0, 29.0))
    assert plan.new_unlocks == ()
    assert [(s.point.monument_id, s.unlocked, s.order) for s in plan.stops] == [
        ("BUR-0001", False, 1), ("BUR-0002", False, 2), ("BUR-0003", False, 3),
        ("BUR-0004", True, 4), ("BUR-0005", True, 5), ("BUR-0006", True, 6)]
    assert plan.next == "BUR-0004"

    done = [Completion(p.monument_id, "2026-10-27T10:00:00+00:00", False) for p in points]
    plan = plan_route(points, done, set(), None)
    assert plan.stops == () and plan.next is None and plan.new_unlocks == ()
    assert len(plan.completed) == 6 and plan.start.source == "last_completed"


# --- /route: kilitler ve sıra -------------------------------------------------------------------------------------

def test_every_published_monument_is_open_from_the_start_r6_7(c):
    user = visitor(c)
    r = c.get("/route", params={"city": "bursa", "user_id": user})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    center = city_center([Point(m, m, "", *COORDS[m]) for m in COORDS])
    assert body["city"] == "bursa" and body["total"] == 10 and body["completed_count"] == 0 and body["completed"] == []
    assert body["start"] == {"source": "city_center", "latitude": round(center[0], 6), "longitude": round(center[1], 6)}
    # R6.7: kilit yok; yayımlanmış ve konumlu eserlerin hepsi baştan seçilebilir. Hepsi "henüz keşfedilmedi".
    assert open_ids(body) == set(COORDS)
    assert {s["progress"] for s in body["stops"]} == {"new"}
    assert [s["order"] for s in body["stops"]] == list(range(1, 11))
    assert body["next"] == body["stops"][0]["monument_id"] == "BUR-0019"
    s = body["stops"][0]
    assert set(s) == {"monument_id", "name", "name_en", "type", "latitude", "longitude", "state", "progress", "quest_ready",
                      "distance_m", "order"}
    assert all(x["quest_ready"] for x in body["stops"])  # R6.8: geliştirme kataloğunda 10 eserin hepsinde görev hazır
    assert (s["name"], s["type"], (s["latitude"], s["longitude"])) == ("Osman Gazi Türbesi", "türbe", COORDS["BUR-0019"])
    for s in body["stops"]:
        assert s["distance_m"] == round(dist(center, s["monument_id"]))
    # İkinci çağrı aynı durumu verir; yeni kilit açılmaz.
    assert route(c, user) == body


def test_progress_states_new_started_and_completed_r6_7(c):
    """R6.7: her eserin oyuncu durumu hesaba bağlıdır: henüz keşfedilmedi → göreve başlandı → bilgi mührü → altın."""
    user = visitor(c)
    store = c.app.state.monument_progress
    store.record_engagement(user, "BUR-0020", "listened")  # anlatım dinlendi: göreve başlandı
    earn_knowledge_seal(c, user, "BUR-0013")  # gerçek soru akışıyla bilgi mührü
    seal(c, user, "BUR-0014")
    seal(c, user, "BUR-0014", "visit")

    body = route(c, user)
    progress = {s["monument_id"]: s["progress"] for s in body["stops"]}
    assert progress["BUR-0020"] == "started" and progress["BUR-0019"] == "new"
    assert open_ids(body) == set(COORDS) - {"BUR-0013", "BUR-0014"}  # tamamlananlar dışında hepsi açık
    assert [(d["monument_id"], d["visit"]) for d in body["completed"]] == [("BUR-0014", True), ("BUR-0013", False)]
    assert body["completed_count"] == 2 and body["start"]["source"] == "last_completed"
    assert body["next"] == body["stops"][0]["monument_id"]  # öneri: en yakın komşu turunun ilk durağı
    # Başka bir hesap bu durumları görmez.
    other = visitor(c)
    assert {s["progress"] for s in route(c, other)["stops"]} == {"new"}


def test_moving_the_user_changes_the_suggestion_not_access(c):
    user = visitor(c)
    at_muradiye = route(c, user, at=COORDS["BUR-0003"])
    assert at_muradiye["start"]["source"] == "user"
    assert open_ids(at_muradiye) == set(COORDS)  # R6.7: konum öneriyi değiştirir, erişimi değil
    assert at_muradiye["stops"][0]["monument_id"] in MURADIYE

    at_ulu = route(c, user, at=COORDS["BUR-0001"])
    assert open_ids(at_ulu) == set(COORDS)
    assert at_ulu["stops"][0]["monument_id"] == "BUR-0001" == at_ulu["next"]
    assert open_ids(route(c, user)) == set(COORDS)


def test_user_location_counts_only_within_30_km_of_the_city_center(c):
    near = (40.0, 29.05)  # merkeze ~21 km
    user = visitor(c)
    body = route(c, user, at=near)
    assert body["start"] == {"source": "user", "latitude": 40.0, "longitude": 29.05}
    assert body["stops"][0]["distance_m"] == round(dist(near, body["stops"][0]["monument_id"]))

    far_user = visitor(c)
    assert route(c, far_user, at=ISTANBUL)["start"]["source"] == "city_center"
    seal(c, far_user, "BUR-0009")
    far = route(c, far_user, at=ISTANBUL)
    assert far["start"] == {"source": "last_completed", "latitude": COORDS["BUR-0009"][0],
                            "longitude": COORDS["BUR-0009"][1]}


def test_muradiye_cluster_route_is_stable_over_http(c):
    cluster = city_center([Point(m, m, "", *COORDS[m]) for m in MURADIYE])
    user = visitor(c)
    bodies = [route(c, user, at=cluster) for _ in range(3)]
    assert bodies[0] == bodies[1] == bodies[2]
    assert {s["monument_id"] for s in bodies[0]["stops"][:4]} == set(MURADIYE)


def test_counts_completed_order_and_gold_seal_flag(c):
    user = visitor(c)
    seal(c, user, "BUR-0001")
    seal(c, user, "BUR-0009")
    seal(c, user, "BUR-0009", "visit")  # yalnızca ziyaret mührü tamamlanma sayılmaz; bilgi mührü sayılır
    seal(c, user, "BUR-0019", "visit")
    body = route(c, user)
    assert body["total"] == 10 and body["completed_count"] == 2
    assert [(d["monument_id"], d["visit"]) for d in body["completed"]] == [("BUR-0009", True), ("BUR-0001", False)]
    assert "BUR-0019" in {s["monument_id"] for s in body["stops"]}
    assert len(body["stops"]) == 8 and len(open_ids(body)) == 8
    assert body["start"]["source"] == "last_completed"


def test_all_completed_has_no_stops_and_no_next(c):
    user = visitor(c)
    for mid in COORDS:
        seal(c, user, mid)
    body = route(c, user)
    assert body["stops"] == [] and body["next"] is None
    assert body["completed_count"] == body["total"] == 10


# --- Şehir kısa adı, doğrulama, erişim ----------------------------------------------------------------------------

def test_city_slug_variants_all_resolve(c):
    user = visitor(c)
    bodies = [route(c, user, city=name) for name in ("bursa", "Bursa", "BURSA", " Bursa ")]
    assert all(b["city"] == "bursa" for b in bodies)
    assert all(b == bodies[0] for b in bodies)


@pytest.mark.parametrize("city", ["ankara", "", "   ", "bursa-x"])
def test_unknown_or_empty_city_is_404(c, city):
    r = c.get("/route", params={"city": city, "user_id": visitor(c)})
    assert r.status_code == 404 and r.json()["detail"] == "Bu şehir için rota bulunamadı."


@pytest.mark.parametrize("params", [
    {"city": "bursa"},
    {"user_id": "ziyaretci-x"},
    {"city": "bursa", "user_id": ""},
    {"city": "bursa", "user_id": "x" * 65},
    {"city": "b" * 65, "user_id": "ziyaretci-x"},
    {"city": "bursa", "user_id": "ziyaretci-x", "lat": 90.5, "lng": 29.0},
    {"city": "bursa", "user_id": "ziyaretci-x", "lat": 40.0, "lng": -180.5},
    {"city": "bursa", "user_id": "ziyaretci-x", "lat": "nan", "lng": 29.0},
    {"city": "bursa", "user_id": "ziyaretci-x", "lat": "kuzey", "lng": 29.0},
    {"city": "bursa", "user_id": "ziyaretci-x", "lat": 40.0},
    {"city": "bursa", "user_id": "ziyaretci-x", "lng": 29.0},
])
def test_invalid_query_is_422(c, params):
    assert c.get("/route", params=params).status_code == 422
    assert c.app.state.monument_progress._db.execute("SELECT COUNT(*) FROM unlocks").fetchone()[0] == 0


def test_account_route_requires_its_own_session(c):
    owner = c.post("/auth/register", json={"email": "sahip@example.com", "password": PASSWORD}).json()["user_id"]
    stranger = TestClient(c.app)
    assert stranger.post("/auth/register", json={"email": "baska@example.com", "password": PASSWORD}).status_code == 201
    anonymous = TestClient(c.app)
    params = {"city": "bursa", "user_id": owner}
    r = anonymous.get("/route", params=params)
    assert r.status_code == 401 and "giriş yapmalısın" in r.json()["detail"]
    assert stranger.get("/route", params=params).status_code == 403
    assert c.app.state.monument_progress.unlocked(owner) == set()  # reddedilen istek kilit açmaz
    assert c.get("/route", params=params).status_code == 200
    assert len(c.app.state.monument_progress.unlocked(owner)) == 3


def _catalog_file(tmp_path, monuments) -> Path:
    def location(lat, lng):
        return {"latitude": lat, "longitude": lng, "accuracy_m": 20, "represents": "building_footprint_centroid",
                "verification_decision_id": DEC, "map_decision_id": DEC}

    doc = {"schema": "vakifname.public_catalog/2", "monuments": [
        {"monument_id": mid, "name": f"Eser {mid}", "type": "cami", "city": city, "district": "Merkez",
         "address": "Adres", "catalog_decision_id": DEC, **({"location": location(*at)} if at else {})}
        for mid, city, at in monuments]}
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(doc), encoding="utf-8")
    return path


def test_cities_are_separate_and_unlocated_monuments_stay_out(tmp_path):
    # İzmir merkezi 38.4425: en yakın üç eser 0103 (0,0025°), 0102 (0,0125°), 0101 (0,0225°); 0104 (0,0375°) kilitli.
    path = _catalog_file(tmp_path, [
        ("BUR-0101", "İZMİR", (38.42, 27.14)), ("BUR-0102", "İzmir", (38.43, 27.14)),
        ("BUR-0103", "izmir", (38.44, 27.14)), ("BUR-0104", "İzmir", (38.48, 27.14)), ("BUR-0105", "İzmir", None),
        ("BUR-0201", "Manisa", (38.61, 27.43)), ("BUR-0202", "Manisa", (38.62, 27.43)),
    ])
    with TestClient(create_app(public_catalog_file=path, demo_api=False)) as client:
        user = visitor(client)
        izmir = route(client, user, city="İzmir")
        assert izmir["city"] == "izmir" and izmir["total"] == 4
        assert open_ids(izmir) == {"BUR-0101", "BUR-0102", "BUR-0103", "BUR-0104"}  # R6.7: kilit yok
        assert "BUR-0105" not in {s["monument_id"] for s in izmir["stops"]}
        manisa = route(client, user, city="manisa")
        assert manisa["total"] == 2 and open_ids(manisa) == {"BUR-0201", "BUR-0202"}  # kalan 2: ikisi de açık
        # Başka şehirdeki mühür bu şehrin başlangıcını ve sayılarını etkilemez.
        client.app.state.monument_progress.add_seal(user, "BUR-0201", "Eser", "knowledge")
        again = route(client, user, city="izmir")
        assert again["completed_count"] == 0 and again["start"]["source"] == "city_center"
        assert open_ids(again) == open_ids(izmir)


# --- Misafir → hesap birleştirme ve hesap silme -------------------------------------------------------------------

def test_merge_user_moves_unlocks_and_keeps_account_rows():
    s = MonumentProgressStore()
    s._db.executemany("INSERT INTO unlocks VALUES (?,?,?)", [
        ("misafir", "BUR-0001", "2026-10-27T09:00:00+00:00"), ("misafir", "BUR-0003", "2026-10-27T09:00:00+00:00"),
        ("u-hesap", "BUR-0003", "2026-10-26T09:00:00+00:00"), ("u-hesap", "BUR-0005", "2026-10-26T09:00:00+00:00")])
    assert s.merge_user("misafir", "u-hesap")["unlocks"] == 1
    assert s.unlocked("u-hesap") == {"BUR-0001", "BUR-0003", "BUR-0005"} and s.unlocked("misafir") == set()
    kept = s._db.execute("SELECT unlocked_at FROM unlocks WHERE user_id='u-hesap' AND monument_id='BUR-0003'").fetchone()
    assert kept[0] == "2026-10-26T09:00:00+00:00"
    assert s.merge_user("u-hesap", "u-hesap") == {"answers": 0, "seals": 0, "unlocks": 0}


def test_merge_keeps_guest_seal_order_for_last_completed():
    s = MonumentProgressStore()
    s.add_seal("misafir", "BUR-0009", "Koza Han", "knowledge")
    s.add_seal("misafir", "BUR-0003", "Muradiye Camii", "knowledge")  # aynı saniyede olabilir: ekleme sırası belirler
    s.merge_user("misafir", "u-hesap")
    assert [d["monument_id"] for d in s.completions("u-hesap")] == ["BUR-0003", "BUR-0009"]


def test_delete_user_removes_unlocks():
    s = MonumentProgressStore()
    s._db.executemany("INSERT INTO unlocks VALUES (?,?,?)", [("u-a", "BUR-0001", "t"), ("u-b", "BUR-0001", "t")])
    s.delete_user("u-a")
    assert s.unlocked("u-a") == set() and s.unlocked("u-b") == {"BUR-0001"}


def test_guest_unlocks_move_to_the_account_and_are_deleted_with_it(c):
    # R6.2'den önce misafirken açılmış kilitler ve mühürler (artık API'den yazılamaz) girişte hesaba taşınır.
    guest = guest_id()
    seal(c, guest, "BUR-0013")
    c.app.state.monument_progress.plan_unlocks(guest, lambda done, unlocked: (None, ("BUR-0019", "BUR-0020", "BUR-0014")))
    guest_unlocked = c.app.state.monument_progress.unlocked(guest)
    assert len(guest_unlocked) == 3

    r = c.post("/auth/register", json={"email": "ayse@example.com", "password": PASSWORD, "visitor_id": guest})
    user_id = r.json()["user_id"]
    store = c.app.state.monument_progress
    assert store.unlocked(guest) == set() and store.unlocked(user_id) == guest_unlocked
    after = route(c, user_id)  # aynı ilerleme; hiçbir kilit kapanmadı
    assert guest_unlocked <= {x["monument_id"] for x in after["stops"] if x["state"] == "unlocked"}

    assert c.delete("/auth/me").status_code == 204
    db = store._db
    for table in ("unlocks", "seals", "quest_answers"):
        assert db.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id=?", (user_id,)).fetchone()[0] == 0
