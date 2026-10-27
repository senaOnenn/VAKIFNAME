"""Tarihî kişi kartları: her kart yayımlanmış bir kayda bağlı ve kaydın metnini aynen taşır (K4)."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from app.people_routes import DEFAULT_PEOPLE_FILE, load_people

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"


def client(people=None):
    app = create_app(public_catalog_file=SNAPSHOT, demo_api=False)
    c = TestClient(app)
    c.__enter__()
    if people is not None:
        app.state.people = people
    return c


def test_every_mapping_entry_resolves_to_a_published_fact_containing_the_name():
    catalog = {m["monument_id"]: m for m in json.loads(SNAPSHOT.read_text(encoding="utf-8"))["monuments"]}
    entries = load_people(DEFAULT_PEOPLE_FILE)
    assert len(entries) == 11
    for p in entries:
        fact = next(f for f in catalog[p["monument_id"]]["facts"] if f["fact_id"] == p["fact_id"])
        assert p["match"] in fact["text"], p


def test_cards_carry_the_fact_text_verbatim_with_source_and_order():
    c = client()
    body = c.get("/monuments/BUR-0019/people").json()
    assert [p["role"] for p in body["people"]] == ["medfun", "yeniden_yaptiran"]
    medfun = body["people"][0]
    assert medfun["name"] == "Osman Gazi" and medfun["role_label"] == "Burada yatıyor"
    fact = next(f for f in c.get("/monuments/BUR-0019").json()["facts"] if f["fact_id"] == medfun["fact_id"])
    assert medfun["text"] == fact["text"]
    assert medfun["source"].endswith(f"s. {fact['source']['pdf_physical_page']}")


def test_monument_without_mapping_has_no_cards_and_unknown_monument_is_404():
    c = client()
    assert c.get("/monuments/BUR-0005/people").json()["people"] == []
    assert c.get("/monuments/BUR-0999/people").status_code == 404
    assert c.get("/monuments/xyz/people").status_code == 422


def test_entry_whose_name_is_not_in_the_fact_or_whose_fact_is_unpublished_is_dropped():
    bad = [
        {"monument_id": "BUR-0001", "person": "Orhan Gazi", "role": "bani", "fact_id": "BUR-0001-F001", "match": "Orhan Gazi"},
        {"monument_id": "BUR-0001", "person": "Biri", "role": "bani", "fact_id": "BUR-0001-F999", "match": "Biri"},
        {"monument_id": "BUR-0001", "person": "Yıldırım Bayezid", "role": "bani", "fact_id": "BUR-0001-F001", "match": "Yıldırım Bayezid"},
    ]
    assert [p["name"] for p in client(bad).get("/monuments/BUR-0001/people").json()["people"]] == ["Yıldırım Bayezid"]


def test_missing_or_broken_mapping_file_means_no_cards(tmp_path):
    assert load_people(tmp_path / "yok.json") == []
    (tmp_path / "bozuk.json").write_text("{", encoding="utf-8")
    assert load_people(tmp_path / "bozuk.json") == []
    (tmp_path / "rol.json").write_text(json.dumps({"people": [{"monument_id": "BUR-0001", "person": "X", "role": "kral",
                                                               "fact_id": "BUR-0001-F001", "match": "X"}]}), encoding="utf-8")
    assert load_people(tmp_path / "rol.json") == []
