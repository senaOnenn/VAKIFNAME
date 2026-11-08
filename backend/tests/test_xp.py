"""XP ve seviye (R6.4): yalnızca doğrulanmış görev kayıtlarından, bir kez; istemci yazamaz; hesaba özel; eski oyuncular
geriye dönük türetilir; simülasyon ziyaret gerçek ziyaret XP'si vermez; mühür ve vakfiye kuralları değişmez."""

import pytest

from app.progress import MonumentProgressStore
from app.xp import LEVEL_THRESHOLDS, XP_RULES, level_for, progression, stage_for
from tests.players import PlayerClient as TestClient
from tests.test_game import (OPEN, PASSWORD, FakeProvider, answers_with, earn_knowledge, engage, make_client, north_of,
                             register, start, state, submit, visit)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("VAKIFNAME_PROGRESS_DB", "VAKIFNAME_ACCOUNTS_DB", "VAKIFNAME_AUTH_RATE", "VAKIFNAME_VISIT_SIMULATION",
                 "VAKIFNAME_VISIT_RADIUS_M"):
        monkeypatch.delenv(name, raising=False)


def xp(c) -> dict:
    r = c.get("/player/xp")
    assert r.status_code == 200, r.text
    return r.json()


def sources(c) -> dict:
    return {(e["source"], e["monument_id"]): e["amount"] for e in xp(c)["events"]}


# --- Matematik ------------------------------------------------------------------------------------------------------

def test_pilot_total_and_level_reachability():
    per_monument = XP_RULES["listened"] + XP_RULES["listen_and_ask"] + XP_RULES["knowledge"] + XP_RULES["visit"]
    assert per_monument == 180
    assert XP_RULES["first_discovery"] + 10 * per_monument == 1825
    online = XP_RULES["first_discovery"] + 10 * (per_monument - XP_RULES["visit"])
    assert online == 825 and level_for(online) == 6  # ziyaretsiz en çok seviye 6
    assert level_for(online + 2 * 100) == 6 and level_for(online + 3 * 100) == 7  # seviye 7: en az 3 gerçek ziyaret
    assert level_for(online + 6 * 100) == 7 and level_for(online + 7 * 100) == 8  # seviye 8: en az 7 gerçek ziyaret
    assert level_for(1825) == 8


@pytest.mark.parametrize("total, level", [(0, 1), (49, 1), (50, 2), (149, 2), (150, 3), (299, 3), (300, 4), (500, 5),
                                          (749, 5), (750, 6), (1099, 6), (1100, 7), (1499, 7), (1500, 8), (99999, 8)])
def test_level_thresholds(total, level):
    assert level_for(total) == level
    p = progression(total)
    assert p["level"] == level and p["level_xp"] == LEVEL_THRESHOLDS[level - 1]
    assert p["next_level_xp"] == (LEVEL_THRESHOLDS[level] if level < 8 else None)


def test_cosmetic_stages():
    assert [stage_for(n) for n in range(1, 9)] == ["baslangic", "baslangic", "gezginlik", "gezginlik",
                                                   "arastirmaci", "arastirmaci", "muhafiz", "muhafiz"]


def test_full_pilot_through_the_store_is_1825_and_repeats_add_nothing():
    s = MonumentProgressStore()
    mids = [f"BUR-90{i:02d}" for i in range(10)]
    for _ in range(2):  # ikinci tur: aynı görevler tekrarlanır
        for m in mids:
            s.record_engagement("u-x", m, "listened")
            s.record_engagement("u-x", m, "asked")
            s.add_seal("u-x", m, m, "knowledge")
            s.add_seal("u-x", m, m, "visit")
        s.sync_xp("u-x")
    assert s.xp_total("u-x") == 1825 and level_for(s.xp_total("u-x")) == 8
    events = s.xp_events("u-x")
    assert len(events) == 1 + 10 * 4
    assert sum(1 for e in events if e["source"] == "first_discovery") == 1


# --- Gerçek görev akışı (API) ---------------------------------------------------------------------------------------

def test_xp_comes_only_from_verified_events_once_each(monkeypatch):
    monkeypatch.setenv("VAKIFNAME_VISIT_SIMULATION", "on")
    with make_client() as c:
        c.app.state.guide_mode = "on"
        c.app.state.guide.provider = FakeProvider(ok=True)  # I. kademe soru da ister
        user = register(c, email="xp@example.com")
        assert xp(c)["total"] == 0

        engage(c, user, OPEN, "listened")
        assert sources(c) == {("first_discovery", OPEN): 25, ("listened", OPEN): 10}  # ilk keşif + dinleme, birer kez
        engage(c, user, OPEN, "listened")  # tekrar: XP yok
        assert xp(c)["total"] == 35

        engage(c, user, OPEN, "asked")
        assert xp(c)["total"] == 55  # dinle ve sor: +20
        engage(c, user, OPEN, "asked")
        assert xp(c)["total"] == 55

        earn_knowledge(c, user, OPEN)  # bilgi mührü (= vakfiye parçası): +50, ayrıca parça ödülü yok
        assert xp(c)["total"] == 105

        sim = visit(c, user, OPEN, simulate=True)
        assert sim["status"] == "gold" and sim["visit_seal"]["simulated"] is True
        assert xp(c)["total"] == 105  # simülasyon ziyaret gerçek ziyaret XP'si vermez

        real = visit(c, user, OPEN, at=north_of(OPEN, 10))
        assert real["status"] == "gold" and real["visit_seal"]["simulated"] is False
        assert xp(c)["total"] == 205  # gerçeğe çevrilen ziyaret: +100, bir kez
        assert visit(c, user, OPEN, at=north_of(OPEN, 10))["status"] == "already"
        assert xp(c)["total"] == 205

        profile = c.get("/player/profile").json()["progress"]
        assert profile["xp"] == 205 and profile["level"] == 3 and profile["stage"] == "gezginlik"
        assert profile["level_xp"] == 150 and profile["next_level_xp"] == 300
        assert [e["source"] for e in profile["recent"]][0] == "visit"
        assert all(e["origin"] == "live" for e in xp(c)["events"])
        # Mühür kuralları değişmedi: bir bilgi ve bir (gerçek) ziyaret mührü.
        s = state(c, user)
        assert s["knowledge"] and s["visit"]["simulated"] is False


def test_optional_listening_and_asking_each_earn_once_r6_7(c_default):
    """R6.7: dinleme ve rehbere soru isteğe bağlı; gerçekten yapılınca birer kez XP. Bilgi görevi bunlardan bağımsız."""
    c = c_default
    user = register(c, email="dinle@example.com")
    s = engage(c, user, OPEN, "listened")
    assert s["guide_required"] is False
    assert sources(c) == {("first_discovery", OPEN): 25, ("listened", OPEN): 10}  # yalnızca dinleme
    engage(c, user, OPEN, "asked")
    engage(c, user, OPEN, "asked")
    assert sources(c)[("listen_and_ask", OPEN)] == 20 and xp(c)["total"] == 55  # soru bir kez

    # Dinlemeden doğrudan görev: ilk keşif ödülü bilgi mühründe verilir (hesap başına bir kez).
    d = register(TestClient(c.app), email="direkt@example.com")
    c2 = TestClient(c.app)
    c2.post("/auth/login", json={"email": "direkt@example.com", "password": PASSWORD})
    q = start(c2, d, OPEN)  # dinleme yok: görev doğrudan açılır
    assert q.status_code == 201
    r = submit(c2, d, q.json()["quiz_id"], answers_with(c2, q.json()["quiz_id"], 4))
    assert r.status_code == 200 and r.json()["passed"] is True
    got = sources(c2)
    assert got == {("first_discovery", OPEN): 25, ("knowledge", OPEN): 50}


def test_r6_4_listen_and_ask_rows_are_kept_and_not_doubled(c_default):
    """R6.4 kuralıyla (dinledi ve sınavı geçti) verilmiş 20 XP geri alınmaz ve yeni kuralla ikinci kez verilmez."""
    c = c_default
    user = register(c, email="eski-xp@example.com")
    db = c.app.state.monument_progress._db
    db.execute("INSERT INTO engagement VALUES (?, ?, 'listened', '2026-10-20T10:00:00+00:00')", (user, OPEN))
    db.execute("INSERT INTO xp_events VALUES (?, 'listen_and_ask', ?, ?, 20, '2026-10-20T10:06:00+00:00', 'live')",
               (user, OPEN, OPEN))
    engage(c, user, OPEN, "asked")  # yeni kuralın koşulu da oluştu
    events = [e for e in xp(c)["events"] if e["source"] == "listen_and_ask"]
    assert len(events) == 1 and events[0]["earned_at"] == "2026-10-20T10:06:00+00:00"


@pytest.fixture
def c_default():
    with make_client() as client:
        yield client


def test_client_cannot_write_xp(c_default):
    c = c_default
    register(c, email="hile@example.com")
    for method in ("post", "put", "patch", "delete"):
        assert getattr(c, method)("/player/xp").status_code == 405
    assert c.put("/player/character", json={"character_id": "erkek", "xp": 5000}).status_code == 422
    assert c.post(f"/monuments/{OPEN}/engagement", json={"user_id": "x", "event": "xp"}).status_code == 422
    assert xp(c)["total"] == 0


def test_xp_is_per_account_and_survives_sign_out(c_default):
    c = c_default
    a = register(c, email="a@example.com")
    engage(c, a, OPEN, "listened")
    b_client = TestClient(c.app)
    register(b_client, email="b@example.com")
    assert xp(b_client) == {"total": 0, "events": []}
    assert b_client.get("/player/xp", params={"user_id": a}).json()["total"] == 0  # kimlik istekten alınmaz
    assert c.get("/player/xp").json()["total"] == 35  # ilk keşif + dinleme (R6.7: soru isteğe bağlı)
    c.post("/auth/logout")
    assert c.get("/player/xp").status_code == 401 and c.get("/player/profile").status_code == 401
    c.post("/auth/login", json={"email": "a@example.com", "password": PASSWORD})
    assert c.get("/player/xp").json()["total"] == 35


def test_existing_players_are_backfilled_without_touching_their_progress(c_default):
    """R6.4 öncesi oyuncu: mühür ve olayları var, XP satırı yok. Profil okununca aynı kurallarla türetilir (`backfill`)."""
    c = c_default
    user = register(c, email="eski@example.com")
    db = c.app.state.monument_progress._db
    # Kayıtlar doğrudan tabloya (XP kancası olmadan, eski sürümdeki gibi) yazılır.
    db.execute("INSERT INTO engagement VALUES (?, 'BUR-0019', 'listened', '2026-10-20T10:00:00+00:00')", (user,))
    db.execute("INSERT INTO seals VALUES (?, 'BUR-0019', 'knowledge', 'Eser', '2026-10-20T10:05:00+00:00', 0)", (user,))
    db.execute("INSERT INTO seals VALUES (?, 'BUR-0019', 'visit', 'Eser', '2026-10-21T10:00:00+00:00', 0)", (user,))
    db.execute("INSERT INTO seals VALUES (?, 'BUR-0020', 'knowledge', 'Eser 2', '2026-10-22T10:00:00+00:00', 0)", (user,))
    db.execute("INSERT INTO seals VALUES (?, 'BUR-0020', 'visit', 'Eser 2', '2026-10-23T10:00:00+00:00', 1)", (user,))
    seals_before = c.app.state.monument_progress.seals(user)
    progress = c.get("/player/profile").json()["progress"]
    # 25 ilk keşif + 10 dinleme + 50 + 100 (BUR-0019) + 50 (BUR-0020; simülasyon ziyaret 0). R6.7: rehbere soru
    # sorulmadığı için soru ödülü yok (eskiden "dinledi ve sınavı geçti" için verilen 20, bu oyuncuda hiç verilmemişti).
    assert progress["xp"] == 235 and progress["level"] == 3
    events = xp(c)["events"]
    assert {e["origin"] for e in events} == {"backfill"}
    first = next(e for e in events if e["source"] == "first_discovery")
    assert first["monument_id"] == "BUR-0019" and first["earned_at"] == "2026-10-20T10:00:00+00:00"
    assert c.app.state.monument_progress.seals(user) == seals_before
    # Tekrar okumak hiçbir şey eklemez.
    assert c.get("/player/profile").json()["progress"]["xp"] == 235


def test_account_deletion_removes_xp(c_default):
    c = c_default
    user = register(c, email="sil@example.com")
    engage(c, user, OPEN, "listened")
    assert c.app.state.monument_progress.xp_total(user) > 0
    assert c.delete("/auth/me").status_code == 204
    assert c.app.state.monument_progress.xp_total(user) == 0
