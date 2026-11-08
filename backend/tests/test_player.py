"""Oyuncu profili ve karakter seçimi (R6.3): yalnızca hesapla, oturumdan; varsayılan karakter yok; ilerlemeye dokunmaz;
istemci XP veya seviye yazamaz."""

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.progress import MonumentProgressStore

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
PASSWORD = "Gizli-Parola-42"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("VAKIFNAME_PROGRESS_DB", "VAKIFNAME_ACCOUNTS_DB", "VAKIFNAME_AUTH_RATE"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def c():
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False)) as client:
        yield client


def register(c, email):
    r = c.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    return r.json()["user_id"]


def test_guest_cannot_read_or_choose_a_character(c):
    assert c.get("/player/profile").status_code == 401
    r = c.put("/player/character", json={"character_id": "erkek"})
    assert r.status_code == 401
    assert c.app.state.monument_progress._db.execute("SELECT COUNT(*) FROM player_profiles").fetchone()[0] == 0


def test_first_sign_in_has_no_character_and_no_default_is_assigned(c):
    register(c, "ilk@example.com")
    r = c.get("/player/profile")
    assert r.status_code == 200 and r.json()["character"] is None
    assert r.headers["cache-control"] == "no-store"
    assert c.app.state.monument_progress._db.execute("SELECT COUNT(*) FROM player_profiles").fetchone()[0] == 0


def test_choice_is_saved_to_the_session_account_and_kept_on_next_sign_in(c):
    uid = register(c, "secen@example.com")
    r = c.put("/player/character", json={"character_id": "kadin"})
    assert r.status_code == 200 and r.json()["character"]["id"] == "kadin"
    assert c.app.state.monument_progress.profile(uid)["character_id"] == "kadin"
    assert c.post("/auth/logout").status_code in (200, 204)
    assert c.get("/player/profile").status_code == 401
    assert c.post("/auth/login", json={"email": "secen@example.com", "password": PASSWORD}).status_code == 200
    assert c.get("/player/profile").json()["character"]["id"] == "kadin"
    # Değiştirmek serbesttir (yalnızca görünüş); ilk seçim zamanı korunur.
    first = c.app.state.monument_progress.profile(uid)["chosen_at"]
    assert c.put("/player/character", json={"character_id": "erkek"}).json()["character"] == {"id": "erkek", "chosen_at": first}


def test_a_cannot_see_or_change_b(c):
    a = register(c, "a@example.com")
    c.put("/player/character", json={"character_id": "erkek"})
    b_client = TestClient(c.app)
    b = register(b_client, "b@example.com")
    assert b_client.get("/player/profile").json()["character"] is None  # A'nın seçimi B'ye görünmez
    # Kimlik gövdeden alınmaz: B başka bir hesabı hedefleyemez.
    r = b_client.put("/player/character", json={"character_id": "erkek", "user_id": a})
    assert r.status_code == 422
    b_client.put("/player/character", json={"character_id": "erkek"})
    store = c.app.state.monument_progress
    assert store.profile(a)["character_id"] == "erkek" and store.profile(b)["character_id"] == "erkek"


@pytest.mark.parametrize("body", [
    {"character_id": "sultan"},
    {"character_id": ""},
    {"character_id": "erkek", "xp": 9999},
    {"character_id": "erkek", "level": 10},
    {},
])
def test_only_known_characters_and_no_client_xp(c, body):
    register(c, "x@example.com")
    assert c.put("/player/character", json=body).status_code == 422
    profile = c.get("/player/profile").json()
    assert profile["character"] is None and profile["progress"]["xp"] == 0  # istemci XP yazamaz


def test_existing_progress_is_untouched_and_profile_is_deleted_with_the_account(c):
    uid = register(c, "eski@example.com")
    store = c.app.state.monument_progress
    store.add_seal(uid, "BUR-0019", "Eser", "knowledge")
    store.record_engagement(uid, "BUR-0019", "listened")
    before = store.seals(uid)
    c.put("/player/character", json={"character_id": "erkek"})
    assert store.seals(uid) == before and store.engagement(uid, "BUR-0019") == {"listened"}
    assert c.delete("/auth/me").status_code == 204
    assert store.profile(uid) is None


def test_old_progress_files_gain_the_profile_table_without_losing_rows(tmp_path):
    path = tmp_path / "p.sqlite3"
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE seals (user_id TEXT NOT NULL, monument_id TEXT NOT NULL, kind TEXT NOT NULL,
            monument_name TEXT NOT NULL, earned_at TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, monument_id, kind));
        INSERT INTO seals VALUES ('u-eski', 'BUR-0001', 'knowledge', 'Ulu Cami', '2026-10-01T10:00:00+00:00', 0);
    """)
    db.commit()
    db.close()
    s = MonumentProgressStore(path)
    assert [x["monument_id"] for x in s.seals("u-eski")] == ["BUR-0001"]
    assert s.profile("u-eski") is None
    s.close()


def test_in_memory_storage_is_announced_at_startup(caplog, monkeypatch):
    """R6.4.2: yol verilmezse hesaplar ve ilerleme bellektedir ve yeniden başlatmada silinir; açılış bunu açıkça uyarır."""
    import logging
    with caplog.at_level(logging.WARNING, logger="vakifname.storage"):
        create_app(public_catalog_file=SNAPSHOT, demo_api=False)
    text = " ".join(r.getMessage() for r in caplog.records if r.name == "vakifname.storage")
    assert "VAKIFNAME_ACCOUNTS_DB" in text and "VAKIFNAME_PROGRESS_DB" in text and "silinir" in text


def test_file_storage_keeps_accounts_and_characters_across_restarts(tmp_path, caplog):
    import logging
    acc, prog = tmp_path / "hesap" / "accounts.sqlite3", tmp_path / "ilerleme" / "progress.sqlite3"
    with caplog.at_level(logging.WARNING, logger="vakifname.storage"):
        with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False, accounts_db=acc, progress_db=prog)) as c:
            register(c, "kalici@example.com")
            c.put("/player/character", json={"character_id": "erkek"})
    assert not [r for r in caplog.records if r.name == "vakifname.storage"]
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False, accounts_db=acc, progress_db=prog)) as c:
        assert c.post("/auth/login", json={"email": "kalici@example.com", "password": PASSWORD}).status_code == 200
        assert c.get("/player/profile").json()["character"]["id"] == "erkek"


def test_new_choices_are_the_two_explorers_and_old_ids_still_read(c):
    """8 Kasım: kadın ve erkek kâşif. Eski kimlikler yeni seçimde reddedilir, kayıtta kalanlar olduğu gibi okunur."""
    uid = register(c, "eski@example.com")
    assert c.put("/player/character", json={"character_id": "gezgin"}).status_code == 422
    assert c.put("/player/character", json={"character_id": "kadin"}).json()["character"]["id"] == "kadin"
    c.app.state.monument_progress._db.execute("UPDATE player_profiles SET character_id='nakkas' WHERE user_id=?", (uid,))
    assert c.get("/player/profile").json()["character"]["id"] == "nakkas"
