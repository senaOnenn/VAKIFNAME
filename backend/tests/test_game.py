"""Gerçek oyun döngüsü (Faz 5): kademe kapıları (dinle/sor → sınav → ziyaret), rota kilidi, 5 soruluk sınavın türleri ve
cevap sızdırmaması, %80 sınırı (4/5 geçer, 3/5 kalır), mührün bir kez verilmesi, yeniden deneme, tek gönderim, süre aşımı,
başkasının sınavı, hesap oturumu, ziyaret yarıçapı (katalog / ortam), sunum modu (simülasyon), konumun saklanmaması, misafir→hesap
birleştirme ve hesap silme. Soru üretimi gerçek yayın anlık görüntüsüyle ve sabit tohumlu rastgelelikle sınanır."""

import json
import random
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import game
from app.game import NameIndex, compose_quiz, fold, public_question
from app.main import create_app
from app.progress import MonumentProgressStore
from app.public_catalog import PublicCatalog

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
RAW = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
CATALOG = PublicCatalog.model_validate(RAW)
BY_ID = {m.monument_id: m for m in CATALOG.monuments}
INITIAL_FRONTIER = {"BUR-0019", "BUR-0020", "BUR-0013"}  # şehir merkezine en yakın üç eser (bkz. test_route.py)
OPEN, LOCKED = "BUR-0019", "BUR-0005"
PASSWORD = "Gizli-Parola-42"
DEC = "DEC-" + "b" * 16
M_PER_DEG_LAT = 6_371_000 * 3.141592653589793 / 180
STATE_KEYS = {"monument_id", "locked", "listened", "asked", "guide_required", "ready_for_quiz", "quiz_size", "pass_mark",
              "knowledge", "visit", "visit_radius_m", "simulated_visit_allowed", "site_notice"}


def visitor() -> str:
    return f"ziyaretci-{uuid.uuid4()}"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("VAKIFNAME_PROGRESS_DB", "VAKIFNAME_ACCOUNTS_DB", "VAKIFNAME_AUTH_RATE", "VAKIFNAME_GOOGLE_CLIENT_ID",
                 "VAKIFNAME_COOKIE_SECURE", "VAKIFNAME_VISIT_RADIUS_M", "VAKIFNAME_VISIT_SIMULATION"):
        monkeypatch.delenv(name, raising=False)


def make_client(catalog_file: Path = SNAPSHOT, seed: int = 7) -> TestClient:
    client = TestClient(create_app(public_catalog_file=catalog_file, demo_api=False))
    client.app.state.game_rng = random.Random(seed)
    return client


@pytest.fixture
def c():
    with make_client() as client:
        yield client


def write_catalog(tmp_path: Path, monuments: list[dict]) -> Path:
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({**RAW, "monuments": monuments}, ensure_ascii=False), encoding="utf-8")
    return path


def raw_monument(mid: str) -> dict:
    return json.loads(json.dumps(next(m for m in RAW["monuments"] if m["monument_id"] == mid)))


# --- Yardımcılar -------------------------------------------------------------------------------------------------

def state(c, user, mid=OPEN):
    r = c.get(f"/monuments/{mid}/game", params={"user_id": user})
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "no-store"
    return r.json()


def engage(c, user, mid=OPEN, *events):
    for event in events or ("listened",):
        r = c.post(f"/monuments/{mid}/engagement", json={"user_id": user, "event": event})
        assert r.status_code == 200, r.text
    return r.json()


def unlock(c, user, mid):
    c.app.state.monument_progress.plan_unlocks(user, lambda done, unlocked: (None, [mid]))


def start(c, user, mid=OPEN):
    return c.post(f"/monuments/{mid}/quiz", json={"user_id": user})


def ready_quiz(c, user, mid=OPEN) -> dict:
    unlock(c, user, mid)
    engage(c, user, mid)
    r = start(c, user, mid)
    assert r.status_code == 201, r.text
    return r.json()


def server_items(c, quiz_id) -> list[dict]:
    """Sunucudaki doğru cevaplar (yalnızca testte okunur)."""
    return c.app.state.monument_progress.quiz(quiz_id)["items"]


def answers_with(c, quiz_id, n_correct: int) -> list[dict]:
    out = []
    for i, item in enumerate(server_items(c, quiz_id)):
        right = item["answer"]
        out.append({"qid": item["qid"],
                    "choice": right if i < n_correct else (right + 1) % game.option_count(item)})
    return out


def submit(c, user, quiz_id, answers):
    return c.post(f"/quiz/{quiz_id}/submit", json={"user_id": user, "answers": answers})


def earn_knowledge(c, user, mid=OPEN):
    quiz = ready_quiz(c, user, mid)
    r = submit(c, user, quiz["quiz_id"], answers_with(c, quiz["quiz_id"], 5))
    assert r.status_code == 200 and r.json()["passed"], r.text
    return r.json()


def location(mid):
    loc = BY_ID[mid].location
    return loc.latitude, loc.longitude


def north_of(mid, metres):
    lat, lng = location(mid)
    return lat + metres / M_PER_DEG_LAT, lng


def visit(c, user, mid=OPEN, at=None, **extra):
    body = {"user_id": user, **extra}
    if at is not None:
        body.update(latitude=at[0], longitude=at[1])
    r = c.post(f"/monuments/{mid}/visit", json=body)
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "no-store"
    return r.json()


def register(c, email="oyuncu@example.com", **extra):
    r = c.post("/auth/register", json={"email": email, "password": PASSWORD, **extra})
    assert r.status_code == 201, r.text
    return r.json()["user_id"]


class FakeProvider:
    name = "sahte"

    def __init__(self, ok=True):
        self.ok = ok

    def available(self):
        return self.ok, "ok" if self.ok else "missing"


# --- Durum ve kademe 1 -------------------------------------------------------------------------------------------

def test_game_state_shape_for_a_new_visitor(c):
    s = state(c, visitor())
    assert set(s) == STATE_KEYS
    assert s == {"monument_id": OPEN, "locked": False, "listened": False, "asked": False, "guide_required": False,
                 "ready_for_quiz": False, "quiz_size": 5, "pass_mark": 4, "knowledge": None, "visit": None,
                 "visit_radius_m": 35, "simulated_visit_allowed": False, "site_notice": BY_ID[OPEN].site_notice}
    assert s["site_notice"]  # türbe uyarısı oyun adımından önce gösterilebilsin


def test_engagement_is_idempotent_and_returns_the_state(c):
    user = visitor()
    first = engage(c, user, OPEN, "listened")
    assert set(first) == STATE_KEYS and first["listened"] and not first["asked"] and first["ready_for_quiz"]
    again = engage(c, user, OPEN, "listened", "asked", "asked")
    assert again["listened"] and again["asked"]
    db = c.app.state.monument_progress._db
    assert db.execute("SELECT COUNT(*) FROM engagement WHERE user_id=?", (user,)).fetchone()[0] == 2
    # Olay yalnızca o esere yazılır.
    assert state(c, user, "BUR-0020")["listened"] is False
    bad = c.post(f"/monuments/{OPEN}/engagement", json={"user_id": user, "event": "watched"})
    assert bad.status_code == 422
    assert c.post(f"/monuments/{OPEN}/engagement", json={"user_id": user, "event": "asked", "x": 1}).status_code == 422


def test_quiz_requires_listening_first(c):
    user = visitor()
    r = start(c, user)
    assert r.status_code == 409 and r.json()["detail"] == "Rozet için önce anlatımı sonuna kadar dinleyin."
    engage(c, user, OPEN, "asked")  # soru tek başına yetmez
    assert start(c, user).status_code == 409
    engage(c, user, OPEN, "listened")
    assert start(c, user).status_code == 201


def test_asked_is_required_only_when_the_guide_is_open_and_configured(c):
    c.app.state.guide_mode = "on"
    c.app.state.guide.provider = FakeProvider(ok=True)
    user = visitor()
    s = engage(c, user, OPEN, "listened")
    assert s["guide_required"] is True and s["ready_for_quiz"] is False
    r = start(c, user)
    assert r.status_code == 409 and "en az bir soru" in r.json()["detail"]
    assert engage(c, user, OPEN, "asked")["ready_for_quiz"] is True
    assert start(c, user).status_code == 201

    # Sağlayıcı girişi/anahtarı yoksa ya da rehber herkese açık değilse soru şartı aranmaz.
    c.app.state.guide.provider = FakeProvider(ok=False)
    assert state(c, visitor())["guide_required"] is False
    c.app.state.guide.provider = None
    assert state(c, visitor())["guide_required"] is False
    c.app.state.guide.provider = FakeProvider(ok=True)
    for mode in ("off", "testers"):
        c.app.state.guide_mode = mode
        other = visitor()
        assert engage(c, other, OPEN, "listened")["guide_required"] is False
        assert start(c, other).status_code == 201


# --- Rota kilidi -------------------------------------------------------------------------------------------------

def test_game_initialises_the_frontier_like_the_route_endpoint(c):
    user = visitor()
    assert state(c, user, LOCKED)["locked"] is True
    assert c.app.state.monument_progress.unlocked(user) == INITIAL_FRONTIER
    route = c.get("/route", params={"city": "bursa", "user_id": user}).json()
    assert {s["monument_id"] for s in route["stops"] if s["state"] == "unlocked"} == INITIAL_FRONTIER
    assert all(state(c, user, mid)["locked"] is False for mid in INITIAL_FRONTIER)

    # Rotayı konumla açmış kullanıcıda sınır yeniden kurulmaz: Muradiye'den açılan rota geçerlidir.
    walker = visitor()
    lat, lng = location("BUR-0003")
    c.get("/route", params={"city": "bursa", "user_id": walker, "lat": lat, "lng": lng})
    opened = c.app.state.monument_progress.unlocked(walker)
    assert LOCKED in opened and OPEN not in opened
    assert state(c, walker, OPEN)["locked"] is True and state(c, walker, LOCKED)["locked"] is False
    assert c.app.state.monument_progress.unlocked(walker) == opened


def test_locked_monument_rejects_quiz_and_legacy_answers(c):
    user = visitor()
    s = engage(c, user, LOCKED, "listened")  # anlatım ve sohbet kilitli eserde de açıktır
    assert s["locked"] is True and s["listened"] is True and s["ready_for_quiz"] is False
    r = start(c, user, LOCKED)
    assert r.status_code == 403 and "kilitli" in r.json()["detail"]
    fact = next(f for f in BY_ID[LOCKED].facts if f.quest)
    legacy = c.post(f"/monuments/{LOCKED}/quests/{fact.fact_id}/answer",
                    json={"user_id": user, "choice_index": fact.quest.answer_index})
    assert legacy.status_code == 403
    assert c.app.state.monument_progress.solved(user) == set()
    assert c.get(f"/monuments/{LOCKED}/quests", params={"user_id": user}).status_code == 200  # okumak serbest
    # Açık eserde eski akış çalışmaya devam eder.
    fact = next(f for f in BY_ID[OPEN].facts if f.quest)
    ok = c.post(f"/monuments/{OPEN}/quests/{fact.fact_id}/answer",
                json={"user_id": user, "choice_index": fact.quest.answer_index})
    assert ok.status_code == 200 and ok.json()["correct"] is True


def test_completed_monument_is_never_reported_locked(c):
    user = visitor()
    state(c, user, OPEN)  # sınır kurulur
    c.app.state.monument_progress.add_seal(user, LOCKED, BY_ID[LOCKED].name, "knowledge")
    s = state(c, user, LOCKED)
    assert s["locked"] is False and s["knowledge"]["earned_at"] and s["ready_for_quiz"] is False
    assert start(c, user, LOCKED).status_code == 409


# --- Sınav içeriği -----------------------------------------------------------------------------------------------

PUBLIC_KEYS = {"choice": {"qid", "kind", "prompt", "choices"}, "image_pick": {"qid", "kind", "prompt", "images"},
               "true_false": {"qid", "kind", "prompt", "statement"}}
FILE_RE = re.compile(r"^[0-9a-f]{64}\.jpe?g$")


@pytest.mark.parametrize("mid", sorted(BY_ID))
def test_every_monument_gets_five_mixed_questions_without_answers(c, mid):
    user = visitor()
    quiz = ready_quiz(c, user, mid)
    assert set(quiz) == {"quiz_id", "expires_at", "questions"} and re.fullmatch(r"[0-9a-f]{32}", quiz["quiz_id"])
    qs = quiz["questions"]
    assert len(qs) == 5 and [q["qid"] for q in qs] == [f"q{i}" for i in range(1, 6)]
    kinds = [q["kind"] for q in qs]
    assert {"choice", "image_pick", "true_false"} <= set(kinds)
    for q in qs:
        assert set(q) == PUBLIC_KEYS[q["kind"]]
    m = BY_ID[mid]
    catalog_choices = {f.quest.question: sorted(f.quest.choices) for f in m.facts if f.quest}
    for q in qs:
        if q["kind"] == "choice":
            assert sorted(q["choices"]) == catalog_choices[q["prompt"]]
        elif q["kind"] == "image_pick":
            assert q["prompt"] == f"Hangisi {m.name}?" and len(q["images"]) == 3
        else:
            assert q["prompt"] == f"Bu bilgi {m.name} ile mi ilgili?"
    # Cevap, kayıt kimliği, sahiplik ve açıklama istemciye gitmez.
    text = json.dumps(quiz, ensure_ascii=False)
    for leak in ("answer", "correct", "explanation", "fact", "key", "owner", "monument_id", "image_id", "certainty"):
        assert f'"{leak}' not in text
    assert not re.search(r"BUR-\d{4}", text)
    asked = {q["prompt"] for q in qs if q["kind"] == "choice"}
    explanations = [f.quest.explanation for f in m.facts if f.quest and f.quest.question in asked]
    assert explanations and not any(e in text for e in explanations)
    assert c.get(f"/monuments/{mid}/game", params={"user_id": user}).json()["ready_for_quiz"] is True


@pytest.mark.parametrize("seed", range(40))
def test_composer_always_builds_five_from_approved_data(seed):
    rng = random.Random(seed)
    names = NameIndex(CATALOG.monuments)
    owner_of_file = {f: m.monument_id for m in CATALOG.monuments for i in m.images for f in (i.file, i.card_file) if f}
    game_files = {f for m in CATALOG.monuments for i in m.images if i.game_use for f in (i.file, i.card_file) if f}
    facts = {f.fact_id: (f, m) for m in CATALOG.monuments for f in m.facts}
    for m in CATALOG.monuments:
        items = compose_quiz(CATALOG, m, rng)
        assert len(items) == 5
        assert len({i["key"] for i in items}) == 5
        used_facts = [i["key"][2:] for i in items if i["kind"] in ("choice", "true_false")]
        assert len(used_facts) == len(set(used_facts))  # ifade, aynı sınavdaki sorunun cevabını vermez
        for item in items:
            assert 0 <= item["answer"] < game.option_count(item)
            if item["kind"] == "choice":
                f, owner = facts[item["key"][2:]]
                assert owner is m and f.game_use and f.quest is not None
                assert item["choices"][item["answer"]] == f.quest.choices[f.quest.answer_index]
            elif item["kind"] == "true_false":
                f, owner = facts[item["key"][2:]]
                assert f.game_use and f.certainty == "documented" and item["statement"] == f.text
                assert not names.mentions(f.text)
                assert item["answer"] == (game.TRUE if owner is m else game.FALSE)
                if owner is not m:
                    assert fold(owner.type) != fold(m.type)
                    assert all(" ".join(g.text.split()) != " ".join(f.text.split()) for g in m.facts)
            else:
                files = [o["file"] for o in item["images"]]
                assert all(FILE_RE.match(f) and f in game_files for f in files)
                owners = [owner_of_file[f] for f in files]
                assert owners[item["answer"]] == m.monument_id and owners.count(m.monument_id) == 1
                assert len(set(owners)) == 3


@pytest.mark.parametrize("mid", sorted(BY_ID))
def test_retake_reuses_a_record_only_when_no_fresh_one_is_left(mid):
    m = BY_ID[mid]
    quest_facts = {f.fact_id for f in m.facts if f.quest}
    images = {i.image_id for i in m.images if i.game_use}
    for seed in range(40):
        rng = random.Random(seed)
        first = compose_quiz(CATALOG, m, rng)
        second = compose_quiz(CATALOG, m, rng, first)
        used_first = {i["key"][2:] for i in first if i["kind"] != "image_pick"}
        used_second = {i["key"][2:] for i in second if i["kind"] != "image_pick"}
        if any(i["kind"] == "choice" and i["key"][2:] in used_first for i in second):
            assert quest_facts <= used_first | used_second, (seed, used_first, used_second)
        first_images = {i["key"][2:] for i in first if i["kind"] == "image_pick"}
        second_images = {i["key"][2:] for i in second if i["kind"] == "image_pick"}
        if first_images & second_images:
            assert images <= first_images | second_images
        assert {i["key"] for i in first} != {i["key"] for i in second}


def test_true_false_never_shows_a_monument_name():
    # Bağımsız denetim: tam ad, alternatif ad ve ayırt edici ad (tür sözcüğü atılmış) hiçbir ifadede geçmez.
    forbidden = set()
    for m in CATALOG.monuments:
        for name in (m.name, *m.alternative_names):
            words = fold(name).split()
            forbidden.add(" ".join(words))
            core = [w for w in words if w not in {"camii", "cami", "turbesi", "medresesi", "han", "hani", "bedesteni",
                                                  "bursa", "sultan"}]
            forbidden.add(" ".join(core))
    assert {"koza", "pirinc", "cem", "ii. murad", "osman gazi", "orhan gazi", "muradiye", "ulu"} & forbidden
    seen = set()
    for seed in range(60):
        rng = random.Random(seed)
        for m in CATALOG.monuments:
            for item in compose_quiz(CATALOG, m, rng):
                if item["kind"] == "true_false":
                    seen.add(item["key"])
                    statement = fold(item["statement"])
                    assert not any(re.search(r"(?<!\w)" + re.escape(n), statement) for n in forbidden), item
    assert len(seen) >= 15
    # Örnek: Pirinç Han'ın "Koza Han'dan sonra yapıldığı için…" bilgisi ve Cem Sultan'ın naaşı hiç ifade olmaz.
    assert "t:BUR-0013-F006" not in seen and "t:BUR-0008-F002" not in seen


def test_false_statements_avoid_shared_and_overlapping_facts():
    seen_false = {}
    for seed in range(80):
        rng = random.Random(seed)
        for m in CATALOG.monuments:
            for item in compose_quiz(CATALOG, m, rng):
                if item["kind"] == "true_false" and item["answer"] == game.FALSE:
                    seen_false.setdefault(m.monument_id, set()).add(item["key"][2:])
    # İki türbede aynen geçen "1863'te Sultan Abdülaziz yeniden yaptırmıştır" ve UNESCO cümleleri "yanlış" olarak
    # kullanılmaz; Cem Sultan'ın firuze-lacivert altıgen çinileri Muradiye Camii için "yanlış" sayılmaz (orada da var).
    for mid, used in seen_false.items():
        assert not {"BUR-0019-F004", "BUR-0020-F004", "BUR-0019-F008"} & used
    assert "BUR-0008-F005" not in seen_false.get("BUR-0003", set())
    # Ulu Cami'nin "kubbenin tepesi açık" bilgisi, kubbesi ortası açık II. Murad Türbesi için "yanlış" sayılmaz.
    assert "BUR-0001-F008" not in seen_false.get("BUR-0007", set())
    assert set(seen_false) == set(BY_ID)


def test_true_false_has_both_answers_when_the_monument_allows_it():
    for mid in ("BUR-0001", "BUR-0005", "BUR-0008"):
        answers = {item["answer"] for seed in range(30)
                   for item in compose_quiz(CATALOG, BY_ID[mid], random.Random(seed)) if item["kind"] == "true_false"}
        assert answers == {game.TRUE, game.FALSE}, mid


def test_image_options_do_not_reveal_the_name(c):
    names = NameIndex(CATALOG.monuments)
    for seed in range(20):
        c.app.state.game_rng = random.Random(seed)
        quiz = ready_quiz(c, visitor(), "BUR-0009")
        for q in quiz["questions"]:
            if q["kind"] != "image_pick":
                continue
            for option in q["images"]:
                assert set(option) == {"file", "attribution"} and FILE_RE.match(option["file"])
                assert option["attribution"] and not names.mentions(option["attribution"])
    # Atfında eser adı geçen görsel hiç seçenek olmaz.
    raw = raw_monument("BUR-0009")
    raw["images"][0]["attribution"] = "Fotoğraf: Koza Han arşivi, CC BY-SA 4.0"
    patched = PublicCatalog.model_validate({**RAW, "monuments": [raw if m["monument_id"] == "BUR-0009" else m
                                                                 for m in RAW["monuments"]]})
    bad = {raw["images"][0]["file"], raw["images"][0]["card_file"]}
    for seed in range(30):
        for m in patched.monuments:
            for item in compose_quiz(patched, m, random.Random(seed)):
                if item["kind"] == "image_pick":
                    assert not bad & {o["file"] for o in item["images"]}


def test_image_distractors_prefer_other_sites():
    # Muradiye külliyesinde dört eser 100 m içinde: fotoğrafta hedef de görünebileceği için çeldirici yapılmaz.
    muradiye = {"BUR-0003", "BUR-0005", "BUR-0007", "BUR-0008"}
    owner_of_file = {f: m.monument_id for m in CATALOG.monuments for i in m.images for f in (i.file, i.card_file) if f}
    for seed in range(30):
        for item in compose_quiz(CATALOG, BY_ID["BUR-0003"], random.Random(seed)):
            if item["kind"] == "image_pick":
                owners = {owner_of_file[o["file"]] for o in item["images"]} - {"BUR-0003"}
                assert not owners & muradiye


def test_public_question_is_a_whitelist():
    item = {"qid": "q1", "kind": "true_false", "prompt": "P", "statement": "S", "answer": 1, "key": "t:x",
            "explanation": "E", "fact": {"title": "T"}}
    assert public_question(item) == {"qid": "q1", "kind": "true_false", "prompt": "P", "statement": "S"}


def test_monument_that_cannot_build_five_questions_is_not_offered(tmp_path):
    # Tek eserli katalogda Sultan II. Murad Türbesi: 2 soru, adı geçmeyen ifadesi yok, başka eser (çeldirici) yok.
    path = write_catalog(tmp_path, [raw_monument("BUR-0007")])
    with make_client(path) as c:
        user = visitor()
        s = engage(c, user, "BUR-0007")
        assert s["locked"] is False and s["listened"] is True and s["ready_for_quiz"] is False
        r = start(c, user, "BUR-0007")
        assert r.status_code == 409 and "yeterli" in r.json()["detail"]
        assert c.app.state.monument_progress._db.execute("SELECT COUNT(*) FROM quizzes").fetchone()[0] == 0


# --- Gönderim ve puanlama ----------------------------------------------------------------------------------------

def test_four_of_five_passes_and_awards_the_knowledge_seal_once(c):
    user = visitor()
    quiz = ready_quiz(c, user)
    r = submit(c, user, quiz["quiz_id"], answers_with(c, quiz["quiz_id"], 4))
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert set(body) == {"score", "total", "passed", "results", "knowledge_seal"}
    assert (body["score"], body["total"], body["passed"]) == (4, 5, True)
    seal = body["knowledge_seal"]
    assert seal["new"] is True and seal["kind"] == "knowledge" and seal["monument_id"] == OPEN and "simulated" not in seal
    assert [x["correct"] for x in body["results"]] == [True] * 4 + [False]
    items = server_items(c, quiz["quiz_id"])
    for res, item in zip(body["results"], items):
        assert set(res) == {"qid", "correct", "correct_choice", "explanation", "fact"}
        assert res["correct_choice"] == item["answer"] and res["explanation"]
        if item["kind"] == "image_pick":
            assert res["fact"] is None
        else:
            assert {"title", "text", "source"} <= set(res["fact"]) and re.search(r", s\. \d+$", res["fact"]["source"])

    s = state(c, user)
    assert s["knowledge"] == {"earned_at": seal["earned_at"]} and s["ready_for_quiz"] is False
    again = start(c, user)
    assert again.status_code == 409 and "zaten" in again.json()["detail"]
    seals = c.get(f"/users/{user}/seals").json()
    assert [s["monument_id"] for s in seals["knowledge_seals"]] == [OPEN]
    db = c.app.state.monument_progress._db
    assert db.execute("SELECT COUNT(*) FROM seals WHERE user_id=?", (user,)).fetchone()[0] == 1


def test_three_of_five_fails_and_a_new_quiz_can_be_started(c):
    user = visitor()
    quiz = ready_quiz(c, user, "BUR-0001")
    body = submit(c, user, quiz["quiz_id"], answers_with(c, quiz["quiz_id"], 3)).json()
    assert (body["score"], body["passed"], body["knowledge_seal"]) == (3, False, None)
    assert state(c, user, "BUR-0001")["knowledge"] is None and state(c, user, "BUR-0001")["ready_for_quiz"] is True
    def records(quiz_id):
        return {i["key"][2:] if i["kind"] != "image_pick" else i["key"] for i in server_items(c, quiz_id)}

    first = records(quiz["quiz_id"])
    retry = start(c, user, "BUR-0001")
    assert retry.status_code == 201 and retry.json()["quiz_id"] != quiz["quiz_id"]
    second = records(retry.json()["quiz_id"])
    # Ulu Cami'de 6 onaylı soru, 6 görsel: yeniden denemede görsel değişir, kayıtların çoğu değişir. İki sınavda da
    # doğru/yanlış sorusu bu esere ait bir bilgi gösterirse sınav başına 4 kayıt gerekir: en fazla iki kayıt tekrar eder
    # (önceliğin kendisi: test_retake_reuses_a_record_only_when_no_fresh_one_is_left).
    assert len(first & second) <= 2
    assert not {k for k in first & second if k.startswith("i:")}
    # Önceki sınav yerini yenisine bırakır.
    assert submit(c, user, quiz["quiz_id"], answers_with(c, retry.json()["quiz_id"], 5)).status_code == 404
    assert c.app.state.monument_progress._db.execute(
        "SELECT COUNT(*) FROM quizzes WHERE user_id=?", (user,)).fetchone()[0] == 1
    passed = submit(c, user, retry.json()["quiz_id"], answers_with(c, retry.json()["quiz_id"], 5)).json()
    assert passed["passed"] is True and passed["knowledge_seal"]["new"] is True


def test_a_quiz_is_submitted_only_once(c):
    user = visitor()
    quiz = ready_quiz(c, user)
    answers = answers_with(c, quiz["quiz_id"], 0)
    assert submit(c, user, quiz["quiz_id"], answers).status_code == 200
    r = submit(c, user, quiz["quiz_id"], answers_with(c, quiz["quiz_id"], 5))
    assert r.status_code == 409 and "zaten" in r.json()["detail"]
    assert state(c, user)["knowledge"] is None


def test_expired_quiz_is_rejected(c):
    user = visitor()
    now = datetime.now(timezone.utc)
    c.app.state.game_clock = lambda: now
    quiz = ready_quiz(c, user)
    assert datetime.fromisoformat(quiz["expires_at"]) == (now + timedelta(minutes=30)).replace(microsecond=0)
    c.app.state.game_clock = lambda: now + timedelta(minutes=30, seconds=1)
    r = submit(c, user, quiz["quiz_id"], answers_with(c, quiz["quiz_id"], 5))
    assert r.status_code == 410 and "süresi" in r.json()["detail"]
    assert state(c, user)["knowledge"] is None
    c.app.state.game_clock = lambda: now + timedelta(minutes=29)
    assert submit(c, user, quiz["quiz_id"], answers_with(c, quiz["quiz_id"], 5)).json()["passed"] is True


def test_someone_elses_quiz_is_forbidden(c):
    owner, other = visitor(), visitor()
    quiz = ready_quiz(c, owner)
    r = submit(c, other, quiz["quiz_id"], answers_with(c, quiz["quiz_id"], 5))
    assert r.status_code == 403
    assert state(c, other)["knowledge"] is None and state(c, owner)["knowledge"] is None
    assert submit(c, owner, quiz["quiz_id"], answers_with(c, quiz["quiz_id"], 5)).status_code == 200


def test_submission_is_validated_before_the_quiz_is_used(c):
    user = visitor()
    quiz = ready_quiz(c, user)
    qid = quiz["quiz_id"]
    good = answers_with(c, qid, 5)
    bad_bodies = [
        good[:4],                                                       # eksik cevap
        good[:4] + [good[0]],                                           # aynı soru iki kez
        good[:4] + [{"qid": "q9", "choice": 0}],                        # bilinmeyen soru
        good[:4] + [{**good[4], "choice": 7}],                          # şık aralık dışında
        good[:4] + [{**good[4], "choice": "1"}],                        # metin sayı kabul edilmez
        good[:4] + [{**good[4], "choice": True}],                       # bool sayı kabul edilmez
        good[:4] + [{**good[4], "extra": 1}],                           # fazladan alan
    ]
    for answers in bad_bodies:
        assert submit(c, user, qid, answers).status_code == 422, answers
    assert c.post(f"/quiz/{qid}/submit", json={"user_id": user, "answers": good, "x": 1}).status_code == 422
    assert c.post("/quiz/not-a-quiz/submit", json={"user_id": user, "answers": good}).status_code == 422
    assert c.post(f"/quiz/{uuid.uuid4().hex}/submit", json={"user_id": user, "answers": good}).status_code == 404
    assert submit(c, user, qid, good).json()["passed"] is True


def test_unknown_monument_is_404_everywhere(c):
    user = visitor()
    assert c.get("/monuments/BUR-0999/game", params={"user_id": user}).status_code == 404
    assert c.post("/monuments/BUR-0999/engagement", json={"user_id": user, "event": "listened"}).status_code == 404
    assert c.post("/monuments/BUR-0999/quiz", json={"user_id": user}).status_code == 404
    assert c.post("/monuments/BUR-0999/visit", json={"user_id": user, "simulate": True}).status_code == 404
    assert c.get(f"/monuments/{OPEN}/game").status_code == 422  # kullanıcı kimliği zorunlu


def test_account_progress_needs_its_own_session(c):
    owner = register(c, email="sahip@example.com")
    quiz = ready_quiz(c, owner)
    anonymous, stranger = TestClient(c.app), TestClient(c.app)
    register(stranger, email="baska@example.com")

    def calls(client):
        return [client.get(f"/monuments/{OPEN}/game", params={"user_id": owner}),
                client.post(f"/monuments/{OPEN}/engagement", json={"user_id": owner, "event": "asked"}),
                client.post(f"/monuments/{OPEN}/quiz", json={"user_id": owner}),
                client.post(f"/quiz/{quiz['quiz_id']}/submit",
                            json={"user_id": owner, "answers": answers_with(c, quiz["quiz_id"], 5)}),
                client.post(f"/monuments/{OPEN}/visit", json={"user_id": owner, "simulate": True})]

    assert [r.status_code for r in calls(anonymous)] == [401] * 5
    assert [r.status_code for r in calls(stranger)] == [403] * 5
    assert state(c, owner)["asked"] is False and state(c, owner)["knowledge"] is None
    r = submit(c, owner, quiz["quiz_id"], answers_with(c, quiz["quiz_id"], 5))
    assert r.status_code == 200 and r.json()["passed"] is True


# --- Ziyaret ------------------------------------------------------------------------------------------------------

def test_visit_needs_the_knowledge_seal_first(c):
    user = visitor()
    r = visit(c, user, at=location(OPEN))
    assert r == {"status": "needs_knowledge", "distance_m": None, "radius_m": 35, "visit_seal": None}
    assert c.get(f"/users/{user}/seals").json()["visit_seals"] == []


def test_visit_inside_and_outside_the_radius(c):
    user = visitor()
    earn_knowledge(c, user)
    far = visit(c, user, at=north_of(OPEN, 60))
    assert far["status"] == "out_of_range" and 59 <= far["distance_m"] <= 61 and far["visit_seal"] is None
    near = visit(c, user, at=north_of(OPEN, 20))
    assert near["status"] == "gold" and 19 <= near["distance_m"] <= 21 and near["radius_m"] == 35
    seal = near["visit_seal"]
    assert seal["kind"] == "visit" and seal["simulated"] is False and seal["new"] is True
    assert visit(c, user, at=north_of(OPEN, 500))["status"] == "already"
    s = state(c, user)
    assert s["visit"] == {"earned_at": seal["earned_at"], "simulated": False}
    seals = c.get(f"/users/{user}/seals").json()
    assert seals["visit_seals"][0]["simulated"] is False and "simulated" not in seals["knowledge_seals"][0]


def test_visit_body_is_strict(c):
    user = visitor()
    earn_knowledge(c, user)
    for body in ({"user_id": user}, {"user_id": user, "latitude": 40.18},
                 {"user_id": user, "latitude": 40.18, "longitude": 29.05, "simulate": "yes"},
                 {"user_id": user, "latitude": 91, "longitude": 29.05},
                 {"user_id": user, "latitude": 40.18, "longitude": 29.05, "accuracy": 5}):
        assert c.post(f"/monuments/{OPEN}/visit", json=body).status_code == 422, body


def test_visit_radius_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("VAKIFNAME_VISIT_RADIUS_M", "100")
    with make_client() as c:
        user = visitor()
        assert state(c, user)["visit_radius_m"] == 100
        earn_knowledge(c, user)
        r = visit(c, user, at=north_of(OPEN, 60))
        assert r["status"] == "gold" and r["radius_m"] == 100
    for bad in ("0", "-5", "abc", "5000"):
        monkeypatch.setenv("VAKIFNAME_VISIT_RADIUS_M", bad)
        with pytest.raises(ValueError):
            create_app(public_catalog_file=SNAPSHOT, demo_api=False)


def test_catalog_checkin_point_and_radius_win(tmp_path):
    raw = raw_monument(OPEN)
    lat, lng = location(OPEN)
    raw["checkin"] = {"latitude": lat + 100 / M_PER_DEG_LAT, "longitude": lng, "radius_m": 80,
                      "point_kind": "entrance", "access_hours_note": "Ziyaret saatlerinde", "safety_note": "Yaya alanı",
                      "decision_id": DEC}
    path = write_catalog(tmp_path, [raw if m["monument_id"] == OPEN else m for m in RAW["monuments"]])
    with make_client(path) as c:
        user = visitor()
        assert state(c, user)["visit_radius_m"] == 80
        earn_knowledge(c, user)
        # Yarıçap onaylı giriş noktasına göredir: harita konumu o noktaya 100 m (dışarıda), 170 m kuzey 70 m (içeride).
        at_centroid = visit(c, user, at=location(OPEN))
        assert at_centroid["status"] == "out_of_range" and at_centroid["radius_m"] == 80
        assert 99 <= at_centroid["distance_m"] <= 101
        r = visit(c, user, at=north_of(OPEN, 170))
        assert r["status"] == "gold" and 69 <= r["distance_m"] <= 71


def test_simulated_visit_is_off_by_default_and_labelled_when_on(monkeypatch):
    with make_client() as c:
        user = visitor()
        assert state(c, user)["simulated_visit_allowed"] is False
        earn_knowledge(c, user)
        r = visit(c, user, simulate=True)
        assert r == {"status": "simulation_disabled", "distance_m": None, "radius_m": 35, "visit_seal": None}
        assert state(c, user)["visit"] is None

    monkeypatch.setenv("VAKIFNAME_VISIT_SIMULATION", "on")
    with make_client() as c:
        user = visitor()
        assert visit(c, user, simulate=True)["status"] == "needs_knowledge"  # simülasyon kademe atlatmaz
        earn_knowledge(c, user)
        assert state(c, user)["simulated_visit_allowed"] is True
        r = visit(c, user, simulate=True)
        assert r["status"] == "gold" and r["distance_m"] is None
        assert r["visit_seal"]["simulated"] is True and r["visit_seal"]["new"] is True
        assert state(c, user)["visit"]["simulated"] is True
        assert c.get(f"/users/{user}/seals").json()["visit_seals"][0]["simulated"] is True
        assert visit(c, user, simulate=True)["status"] == "already"
        # Uzaktan gerçek ziyaret simülasyon mührünü değiştirmez; yerinde gerçek ziyaret mührü gerçeğe çevirir.
        assert visit(c, user, at=north_of(OPEN, 300))["status"] == "out_of_range"
        assert state(c, user)["visit"]["simulated"] is True
        real = visit(c, user, at=north_of(OPEN, 10))
        assert real["status"] == "gold" and real["visit_seal"]["simulated"] is False and real["visit_seal"]["new"] is True
        assert visit(c, user, simulate=True)["status"] == "already"
        assert state(c, user)["visit"]["simulated"] is False
    monkeypatch.setenv("VAKIFNAME_VISIT_SIMULATION", "maybe")
    with pytest.raises(ValueError):
        create_app(public_catalog_file=SNAPSHOT, demo_api=False)


def test_game_responses_never_use_the_word_demo(monkeypatch):
    # Genel arayüz paketinin derleme denetimi /\bdemo\b/i sözcüğünü yasaklar; API alan ve durum adları da onu kullanmaz.
    monkeypatch.setenv("VAKIFNAME_VISIT_SIMULATION", "on")
    with make_client() as c:
        user = visitor()
        bodies = [state(c, user)]
        quiz = ready_quiz(c, user)
        bodies.append(quiz)
        bodies.append(submit(c, user, quiz["quiz_id"], answers_with(c, quiz["quiz_id"], 5)).json())
        bodies.append(visit(c, user, simulate=True))
        bodies.append(state(c, user))
        bodies.append(c.get(f"/users/{user}/seals").json())
        other = visitor()
        earn_knowledge(c, other, "BUR-0020")
        c.app.state.game_settings = game.GameSettings(visit_simulation=False)
        bodies.append(visit(c, other, "BUR-0020", simulate=True))
        assert bodies[-1]["status"] == "simulation_disabled"
        for body in bodies:
            assert not re.search(r"\bdemo\b", json.dumps(body, ensure_ascii=False), re.I), body


def test_visited_coordinates_are_never_stored(tmp_path):
    db_path = tmp_path / "progress.sqlite3"
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False, progress_db=db_path)) as c:
        user = visitor()
        earn_knowledge(c, user)
        far, near = north_of(OPEN, 400.123), north_of(OPEN, 12.345)
        assert visit(c, user, at=far)["status"] == "out_of_range"
        assert visit(c, user, at=near)["status"] == "gold"
    db = sqlite3.connect(db_path)
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    values = [v for t in tables for row in db.execute(f"SELECT * FROM {t}") for v in row]
    needles = {f"{x:.4f}" for x in (*far, *near)} - {f"{x:.4f}" for x in location(OPEN)}
    for v in values:
        assert not isinstance(v, float), v
        assert not any(n in str(v) for n in needles), v
    columns = {c[1] for t in tables for c in db.execute(f"PRAGMA table_info({t})")}
    assert not {"latitude", "longitude", "lat", "lng", "distance_m"} & columns


# --- Hesaplar: birleştirme ve silme ------------------------------------------------------------------------------

def test_guest_game_progress_moves_to_the_account(monkeypatch):
    monkeypatch.setenv("VAKIFNAME_VISIT_SIMULATION", "on")
    with make_client() as c:
        guest = visitor()
        earn_knowledge(c, guest, OPEN)
        visit(c, guest, OPEN, simulate=True)
        engage(c, guest, "BUR-0020", "listened", "asked")
        open_quiz = ready_quiz(c, guest, "BUR-0013")
        user_id = register(c, visitor_id=guest)

        s = state(c, user_id, OPEN)
        assert s["knowledge"] and s["visit"]["simulated"] is True
        assert state(c, user_id, "BUR-0020")["asked"] is True
        # Misafirken açılan sınav girişten sonra hesap kimliğiyle gönderilir.
        r = submit(c, user_id, open_quiz["quiz_id"], answers_with(c, open_quiz["quiz_id"], 5))
        assert r.status_code == 200 and r.json()["passed"] is True
        db = c.app.state.monument_progress._db
        for table in ("engagement", "quizzes", "seals", "unlocks"):
            assert db.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id=?", (guest,)).fetchone()[0] == 0, table

        assert c.delete("/auth/me").status_code == 204
        for table in ("engagement", "quizzes", "seals", "unlocks", "quest_answers"):
            assert db.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id=?", (user_id,)).fetchone()[0] == 0, table


def test_merge_keeps_account_rows_but_a_real_visit_beats_a_simulated_one():
    s = MonumentProgressStore()
    s.add_seal("u-hesap", "BUR-0001", "Ulu Cami", "visit", simulated=True)
    s.add_seal("u-hesap", "BUR-0003", "Muradiye Camii", "visit")
    s.record_engagement("u-hesap", "BUR-0001", "listened")
    s.add_seal("misafir", "BUR-0001", "Ulu Cami", "visit")
    s.add_seal("misafir", "BUR-0003", "Muradiye Camii", "visit", simulated=True)
    s.add_seal("misafir", "BUR-0005", "Muradiye Medresesi", "visit", simulated=True)
    s.record_engagement("misafir", "BUR-0001", "listened")
    s.record_engagement("misafir", "BUR-0001", "asked")
    kept = s.seal("u-hesap", "BUR-0003", "visit")["earned_at"]
    s.merge_user("misafir", "u-hesap")
    flags = {x["monument_id"]: x["simulated"] for x in s.seals("u-hesap")}
    assert flags == {"BUR-0001": 0, "BUR-0003": 0, "BUR-0005": 1}
    assert s.seal("u-hesap", "BUR-0003", "visit")["earned_at"] == kept
    assert s.engagement("u-hesap", "BUR-0001") == {"listened", "asked"}
    assert s.seals("misafir") == [] and s.engagement("misafir", "BUR-0001") == set()
    # Bilgi mührü hiçbir zaman simülasyon değildir.
    record, _ = s.add_seal("u-hesap", "BUR-0009", "Koza Han", "knowledge", simulated=True)
    assert record["simulated"] == 0


def test_older_progress_files_are_upgraded_in_place(tmp_path):
    path = tmp_path / "old.sqlite3"
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE seals (user_id TEXT NOT NULL, monument_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('knowledge', 'visit')), monument_name TEXT NOT NULL,
            earned_at TEXT NOT NULL, PRIMARY KEY (user_id, monument_id, kind));
        INSERT INTO seals VALUES ('ziyaretci-1', 'BUR-0001', 'visit', 'Ulu Cami', '2026-10-01T10:00:00+00:00');
    """)
    db.commit()
    db.close()
    s = MonumentProgressStore(path)
    (old,) = s.seals("ziyaretci-1")
    assert old["simulated"] == 0
    assert s.record_engagement("ziyaretci-1", "BUR-0001", "listened") is True
    s.close()
