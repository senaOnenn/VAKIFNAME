"""R6.8: bilgi görevlerinin gerçek geliştirme kataloğunda oynanabilirliği.

1. Kapsam: yayımlanmış 10 Bursa eserinin her birinde onaylı kayıtlardan 5 soruluk sınav kurulabilir; her sorunun dayandığı
   kayıt (bilgi, keşif sorusu ya da görsel) katalogda yayımlanmış ve oyun onaylıdır (kaynak kimliği taşır).
2. Uçtan uca (gerçek katalog, HTTP): Osman Gazi Türbesi'nde dinlemeden görev → 5 soru → 3/5 kalır (mühür ve XP yok) →
   yeni görev → 4/5 geçer → bilgi mührü, vakfiye parçası (rotada tamamlanan) ve 50 XP (+ hesabın ilk keşfi 25) → aynı
   görev ikinci kez verilmez, XP ikilenmez → başka hesap bu ilerlemeyi görmez.
"""

import json
import random
from pathlib import Path

import pytest

from app import game
from app.public_catalog import PublicCatalog
from tests.players import PlayerClient as TestClient
from tests.test_game import answers_with, make_client, register, start, state, submit

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
CATALOG = PublicCatalog.model_validate(json.loads(SNAPSHOT.read_text(encoding="utf-8")))
BURSA = [m for m in CATALOG.monuments if m.city == "Bursa"]


def test_catalog_has_the_ten_published_bursa_monuments():
    assert len(BURSA) == 10


@pytest.mark.parametrize("m", BURSA, ids=lambda m: m.monument_id)
def test_every_bursa_monument_has_a_playable_five_question_quest(m):
    for seed in range(5):  # farklı karışımlarda da (yeniden deneme) 5 soru kurulur
        items = game.compose_quiz(CATALOG, m, random.Random(seed))
        assert len(items) == game.QUIZ_SIZE, (m.monument_id, seed)
    facts = {f.fact_id: f for o in CATALOG.monuments for f in o.facts}
    images = {i.image_id: i for o in CATALOG.monuments for i in o.images}
    for item in game.compose_quiz(CATALOG, m, random.Random(0)):
        kind, _, ref = item["key"].partition(":")
        if kind in ("c", "t"):  # keşif sorusu ya da doğru/yanlış ifadesi: yayımlanmış, oyun onaylı kayıt
            f = facts[ref]
            assert f.game_use, ref
            if kind == "c":
                assert f.quest is not None and item["answer"] < len(item["choices"])
        else:  # görsel sorusu: oyun onaylı, atıflı görsel
            assert kind == "i" and images[ref].game_use and images[ref].attribution


def test_osman_gazi_quest_end_to_end_on_the_real_catalog():
    mid = "BUR-0019"
    with make_client(SNAPSHOT) as c:
        user = register(c, email="oyuncu-e2e@example.com")
        s = state(c, user, mid)
        assert s["quiz_available"] is True and s["ready_for_quiz"] is True and s["listened"] is False

        # 3/5: kalır; mühür ve bilgi XP'si yok.
        q1 = start(c, user, mid)
        assert q1.status_code == 201 and len(q1.json()["questions"]) == 5
        fail = submit(c, user, q1.json()["quiz_id"], answers_with(c, q1.json()["quiz_id"], 3))
        assert fail.status_code == 200 and fail.json()["passed"] is False and fail.json()["knowledge_seal"] is None
        assert state(c, user, mid)["knowledge"] is None
        assert c.get("/player/xp").json()["total"] == 0

        # Yeni görev, 4/5: geçer.
        q2 = start(c, user, mid)
        assert q2.status_code == 201
        ok = submit(c, user, q2.json()["quiz_id"], answers_with(c, q2.json()["quiz_id"], 4))
        assert ok.status_code == 200 and ok.json()["passed"] is True and ok.json()["score"] == 4
        assert ok.json()["knowledge_seal"] is not None
        assert state(c, user, mid)["knowledge"] is not None

        # Vakfiye parçası: rotada tamamlanan eser; XP: ilk keşif 25 + bilgi mührü 50.
        route = c.get("/route", params={"city": "bursa", "user_id": user}).json()
        assert [d["monument_id"] for d in route["completed"]] == [mid] and route["completed_count"] == 1
        events = {(e["source"], e["monument_id"]): e["amount"] for e in c.get("/player/xp").json()["events"]}
        assert events == {("first_discovery", mid): 25, ("knowledge", mid): 50}

        # Tekrar: görev yeniden açılmaz, XP ikilenmez.
        again = start(c, user, mid)
        assert again.status_code == 409
        assert c.get("/player/xp").json()["total"] == 75

        # Başka hesap bu ilerlemeyi görmez.
        other = TestClient(c.app)
        b = register(other, email="baska-e2e@example.com")
        assert other.get(f"/monuments/{mid}/game", params={"user_id": b}).json()["knowledge"] is None
        assert other.get(f"/monuments/{mid}/game", params={"user_id": user}).status_code == 403
