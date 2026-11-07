"""Çok şehir: yeni şehir kendi kimlik önekiyle (ör. KUT-0001) kataloğa girer; liste, eser sayfası, rota ve oyun Bursa'ya
özel bir sabite takılmadan çalışır ve şehirler birbirinin rotasına karışmaz."""
import json
from pathlib import Path

import pytest
from tests.players import PlayerClient as TestClient, new_player
from pydantic import ValidationError

from app.main import create_app
from app.public_catalog import PublicFact

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
RAW = json.loads(SNAPSHOT.read_text(encoding="utf-8"))


def kutahya_copy(source_id: str = "BUR-0007", new_id: str = "KUT-0001") -> dict:
    """Bir Bursa kaydının kimlikleri yeni şehir önekine çevrilmiş kopyası (Kütahya merkezine taşınmış)."""
    m = json.loads(json.dumps(next(x for x in RAW["monuments"] if x["monument_id"] == source_id)).replace(source_id, new_id))
    m["city"], m["district"] = "Kütahya", "Merkez"
    m["location"] = {**m["location"], "latitude": 39.4192, "longitude": 29.9857}
    return m


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("VAKIFNAME_PROGRESS_DB", "VAKIFNAME_ACCOUNTS_DB", "VAKIFNAME_VISIT_SIMULATION"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def c(tmp_path):
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({**RAW, "monuments": RAW["monuments"] + [kutahya_copy()]}, ensure_ascii=False),
                    encoding="utf-8")
    with TestClient(create_app(public_catalog_file=path, demo_api=False)) as client:
        yield client


def visitor(c) -> str:
    """Yeni oyuncu hesabı (R6.2: oyun yalnızca hesapla)."""
    return new_player(c)


def test_new_city_monument_is_listed_and_readable(c):
    ids = {m["monument_id"]: m["city"] for m in c.get("/monuments").json()["monuments"]}
    assert ids["KUT-0001"] == "Kütahya"
    detail = c.get("/monuments/KUT-0001").json()
    assert detail["facts"] and all(f["fact_id"].startswith("KUT-0001-F") for f in detail["facts"])


def test_each_city_has_its_own_route(c):
    user = visitor(c)
    kut = c.get("/route", params={"city": "kutahya", "user_id": user}).json()
    assert kut["city"] == "kutahya" and kut["total"] == 1
    assert [s["monument_id"] for s in kut["stops"]] == ["KUT-0001"]
    bur = c.get("/route", params={"city": "bursa", "user_id": user}).json()
    assert bur["total"] == 10 and "KUT-0001" not in {s["monument_id"] for s in bur["stops"]}


def test_new_city_monument_enters_the_game_unlocked(c):
    state = c.get("/monuments/KUT-0001/game", params={"user_id": visitor(c)}).json()
    assert state["monument_id"] == "KUT-0001" and state["locked"] is False


@pytest.mark.parametrize("fact_id", ["KU-0001-F001", "KUT-001-F001", "kut-0001-F001", "KUT-0001-X001"])
def test_fact_id_still_requires_city_code_and_number(fact_id):
    base = next(f for f in RAW["monuments"][0]["facts"])
    with pytest.raises(ValidationError):
        PublicFact.model_validate({**base, "fact_id": fact_id})
