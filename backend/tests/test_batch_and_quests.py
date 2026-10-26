"""Bağımsız kaynakla yayın, toplu inceleme, Commons görselleri ve keşif oyunu/pasaport (kurgusal veriyle)."""

import hashlib
import json

from fastapi.testclient import TestClient

from app.internal.publish import build_snapshot, write_snapshot
from app.main import create_app
from app.progress import MonumentProgressStore
from tests.test_review_workflow import (  # noqa: F401 — `env` pytest fixture'ı olarak kullanılır
    IDENTITY, REVIEW, Clock, decide, env, login, make_client,
)

ORIGINAL = "Test eseri, bağımsız resmî kayda göre kurgusal bir sultan tarafından yaptırılmıştır."
PUBLISH = {"basis": "independent_corroboration", "title": "Kurgusal yapım", "public_text": ORIGINAL,
           "corroboration_source_ids": ["IS-KP-9001"]}
QUIZ = {"question": "Test eserini kim yaptırdı?", "choices": ["Kurgusal sultan", "Başka biri", "Bilinmiyor"],
        "answer_index": 0, "explanation": "Bağımsız kayıt böyle yazar."}


def corroboration_doc(public_text=ORIGINAL):
    return {
        "sources": [{"source_id": "IS-KP-9001", "kind": "official_portal", "publisher": "Test Bakanlığı",
                     "title": "Test eseri", "url": "https://example.org/test-eseri", "accessed_at": "2026-10-24"}],
        "facts": [{"fact_id": "BUR-9001-F001", "verdict": "corroborated",
                   "corroborations": [{"source_id": "IS-KP-9001", "excerpt": "kurgusal sultan yaptırmıştır"}],
                   "public_title": "Kurgusal yapım", "public_text": public_text, "notes": "Test.",
                   "recommended_action": "approve_publication", "quiz": QUIZ}],
        "issue_proposals": [],
    }


def commons_doc(root):
    """Kurgusal bir Commons kaydı: ayrıntı ve kart dosyası veri dizinine yazılır."""
    d = root / "images" / "commons" / "BUR-9001"
    d.mkdir(parents=True)
    files = {}
    for name, data in (("abc-1600.jpg", b"KURGUSAL-AYRINTI"), ("abc-card.jpg", b"KURGUSAL-KART")):
        (d / name).write_bytes(data)
        files[name] = (hashlib.sha256(data).hexdigest(), len(data))
    return {"images": [{
        "image_id": "commons/BUR-9001/abc", "monument_id": "BUR-9001", "relative_path": "BUR-9001/abc-1600.jpg",
        "sha256": files["abc-1600.jpg"][0], "size_bytes": files["abc-1600.jpg"][1], "width": 1600, "height": 1000,
        "card": {"relative_path": "BUR-9001/abc-card.jpg", "sha256": files["abc-card.jpg"][0],
                 "size_bytes": files["abc-card.jpg"][1], "width": 900, "height": 563},
        "rank": 0,
        "commons": {"title": "File:Test.jpg", "file_page_url": "https://commons.wikimedia.org/wiki/File:Test.jpg",
                    "license_short_name": "CC BY-SA 4.0", "artist": "Test Fotoğrafçı"},
        "proposed_rights": {"rights_holder": "Test Fotoğrafçı", "license": "CC-BY-SA-4.0",
                            "attribution": "Fotoğraf: Test Fotoğrafçı, CC BY-SA 4.0, Wikimedia Commons",
                            "source_url": "https://commons.wikimedia.org/wiki/File:Test.jpg", "monument_match": "confirmed"},
    }]}


def setup_files(env, public_text=ORIGINAL):
    cor = env["tmp"] / "corroboration.json"
    cor.write_text(json.dumps(corroboration_doc(public_text), ensure_ascii=False), encoding="utf-8")
    commons = env["tmp"] / "commons.json"
    commons.write_text(json.dumps(commons_doc(env["root"]), ensure_ascii=False), encoding="utf-8")
    proposals = env["tmp"] / "proposals.json"
    proposals.write_text(json.dumps({"identity": [{"monument_id": "BUR-9001", "payload": IDENTITY, "recommended": True}],
                                     "location": []}, ensure_ascii=False), encoding="utf-8")
    return {"corroboration_file": cor, "commons_file": commons, "proposals_file": proposals}


# --- Bağımsız kaynakla yayın -------------------------------------------------------------

def test_independent_corroboration_publishes_without_source_book_rights(env):
    clock = Clock()
    with make_client(env, clock, **setup_files(env)) as c:
        login(c, env, "editor")
        assert decide(c, clock, "monument", "BUR-9001", "catalog_identity", source_check="verified_on_page",
                      payload=IDENTITY).status_code == 201
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_editorial", source_check="verified_on_page").status_code == 201
        # Kaynak kitap hakkı yokken kitap dayanaklı yayın reddedilir…
        r = decide(c, clock, "fact", "BUR-9001-F001", "fact_publication",
                   payload={**PUBLISH, "basis": "licensed_source", "corroboration_source_ids": []})
        assert r.status_code == 409 and "source_usage_rights" in r.json()["detail"]["message"]
        # …bağımsız kaynak + özgün metinle kabul edilir.
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_publication", payload=PUBLISH).status_code == 201
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_game_use", payload=QUIZ).status_code == 201
        (m,) = build_snapshot(c.app.state.review)[0].monuments
    (f,) = m.facts
    assert f.text == ORIGINAL and f.basis == "independent_corroboration"
    assert f.sources[0].url == "https://example.org/test-eseri"
    assert f.quest.answer_index == 0


def test_unsupported_corroboration_source_is_rejected(env):
    clock = Clock()
    with make_client(env, clock, **setup_files(env)) as c:
        login(c, env, "editor")
        assert decide(c, clock, "monument", "BUR-9001", "catalog_identity", source_check="verified_on_page",
                      payload=IDENTITY).status_code == 201
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_editorial", source_check="verified_on_page").status_code == 201
        bad_source = {**PUBLISH, "corroboration_source_ids": ["IS-YOK"]}
        r = decide(c, clock, "fact", "BUR-9001-F001", "fact_publication", payload=bad_source)
        assert r.status_code == 409 and "corroboration_source_invalid:IS-YOK" in r.json()["detail"]["message"]


def test_copy_check_blocks_eight_word_overlap():
    from app.internal.corroboration import copies_source
    quote = "Caminin beden duvarları, erken dönem yapılarında görüldüğü gibi, üç sıra tuğla ve bir sıra moloz taş ile örülmüştür."
    assert copies_source("Duvarlar erken dönem yapılarında görüldüğü gibi üç sıra tuğla ve bir sıra taşla örülür.", quote)
    assert not copies_source("Duvarlarda üç sıra tuğla ile bir sıra taş dönüşümlü dizilmiştir.", quote)


# --- Toplu inceleme ----------------------------------------------------------------------

def _batch(c, keys, clock, wait=60):
    t = c.post("/internal/review/batch/tickets", headers=REVIEW, json={"keys": keys})
    assert t.status_code == 200, t.text
    clock.advance(wait)
    return t.json()


def test_batch_lists_only_role_allowed_items_and_records_each_decision_in_order(env):
    clock = Clock()
    with make_client(env, clock, **setup_files(env)) as c:
        login(c, env, "editor")
        listing = c.get("/internal/review/batch", headers=REVIEW).json()
        by = {st["decision_type"]: st for st in listing["stages"]}
        assert listing["reviewer_roles"] == ["editor"]
        assert all(i["allowed"] for i in by["fact_publication"]["items"])
        assert not any(i["allowed"] for i in by["image_rights"]["items"])
        pub = by["fact_publication"]["items"][0]
        # Yayın kararı aynı toplu işlemde verilebilecek önceki kararlara bağlı görünür.
        assert set(pub["depends_on"]) == {"fact_editorial|BUR-9001-F001", "catalog_identity|BUR-9001"}
        assert all(not i["done"] for st in listing["stages"] for i in st["items"])

        keys = ["fact_game_use|BUR-9001-F001", "fact_publication|BUR-9001-F001", "catalog_identity|BUR-9001",
                "fact_editorial|BUR-9001-F001"]
        # Rol dışı kayıt bilete alınamaz.
        assert c.post("/internal/review/batch/tickets", headers=REVIEW,
                      json={"keys": keys + ["image_rights|commons/BUR-9001/abc"]}).status_code == 403
        ticket = _batch(c, keys, clock)
        items = [{"key": "fact_game_use|BUR-9001-F001", "decision": "approved", "payload": QUIZ},
                 {"key": "fact_publication|BUR-9001-F001", "decision": "approved", "payload": PUBLISH},
                 {"key": "catalog_identity|BUR-9001", "decision": "approved", "source_check": "verified_on_page", "payload": IDENTITY},
                 {"key": "fact_editorial|BUR-9001-F001", "decision": "approved", "source_check": "verified_on_page"}]
        r = c.post("/internal/review/batch/decisions", headers=REVIEW,
                   json={"ticket_id": ticket["ticket_id"], "rationale": "Kaynak sayfalarını tek tek açıp kontrol ettim.", "items": items})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["recorded"] == 4 and body["failed"] == 0
        # Bağımlılık sırasıyla kaydedildi: önce doğruluk, sonra kimlik, yayın ve oyun.
        assert [x["key"].split("|")[0] for x in body["results"]] == [
            "fact_editorial", "catalog_identity", "fact_publication", "fact_game_use"]
        audit = c.get("/internal/review/audit", headers=REVIEW).json()
        actions = [e["action"] for e in audit["entries"]]
        assert actions.count("decision_recorded") == 4 and "batch_review_submitted" in actions
        assert audit["verification"]["valid"] is True
        history = c.get("/internal/review/subjects/fact/BUR-9001-F001", headers=REVIEW).json()["history"]
        assert all(h["reviewer_id"] == "editor.a" and "[toplu inceleme]" in h["rationale"] for h in history)
        # Bilet tek kullanımlıktır.
        again = c.post("/internal/review/batch/decisions", headers=REVIEW,
                       json={"ticket_id": ticket["ticket_id"], "rationale": "Yeniden gönderim denemesi.", "items": items[:1]})
        assert again.status_code == 409


def test_batch_requires_review_time_and_strips_payload_on_rejection(env):
    clock = Clock()
    with make_client(env, clock, **setup_files(env)) as c:
        login(c, env, "editor")
        t = _batch(c, ["catalog_identity|BUR-9001"], clock, wait=1)
        r = c.post("/internal/review/batch/decisions", headers=REVIEW, json={
            "ticket_id": t["ticket_id"], "rationale": "Hızlı onay denemesi yapıldı.",
            "items": [{"key": "catalog_identity|BUR-9001", "decision": "approved", "payload": IDENTITY,
                       "source_check": "verified_on_page"}]})
        assert r.status_code == 429
        t = _batch(c, ["catalog_identity|BUR-9001"], clock, wait=1)
        # Düzeltme kararında kimlik alanları istenmez; gönderilse bile kayda yazılmaz ve süre beklenmez.
        r = c.post("/internal/review/batch/decisions", headers=REVIEW, json={
            "ticket_id": t["ticket_id"], "rationale": "Adres güncel değil, düzeltilmeli.",
            "items": [{"key": "catalog_identity|BUR-9001", "decision": "needs_revision", "payload": {"x": 1}}]})
        assert r.status_code == 200 and r.json()["recorded"] == 1
        (h,) = c.get("/internal/review/subjects/monument/BUR-9001", headers=REVIEW).json()["history"]
        assert h["decision"] == "needs_revision" and h["payload"] == {}


def test_revised_fact_is_resubmitted_without_touching_the_earlier_decision(env):
    clock = Clock()
    files = setup_files(env)
    with make_client(env, clock, **files) as c:
        login(c, env, "editor")
        t = _batch(c, ["fact_editorial|BUR-9001-F001"], clock)
        r = c.post("/internal/review/batch/decisions", headers=REVIEW, json={
            "ticket_id": t["ticket_id"], "rationale": "Bağımsız kaynak eklenmeli, tarih düzeltilmeli.",
            "items": [{"key": "fact_editorial|BUR-9001-F001", "decision": "needs_revision"}]})
        assert r.status_code == 200
        (first,) = c.get("/internal/review/subjects/fact/BUR-9001-F001", headers=REVIEW).json()["history"]

    # Düzeltme yalnızca bağımsız kaynak dosyasına yazılır; karar kaydı değişmez ve bayatlamaz.
    doc = corroboration_doc()
    doc["facts"][0]["revision"] = {"addresses_decision_id": first["decision_id"], "revised_at": "2026-10-24",
                                   "changes": ["Kaynak eklendi."], "pending_evidence": ["Bir kaynak açılamadı."]}
    files["corroboration_file"].write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    with make_client(env, clock, **files) as c:
        login(c, env, "editor")
        listing = c.get("/internal/review/batch", headers=REVIEW).json()
        (item,) = [i for st in listing["stages"] if st["decision_type"] == "fact_editorial" for i in st["items"]]
        assert item["status"] == "needs_revision" and not item["stale"] and not item["done"]
        assert item["revision"]["open"] is True and item["revision"]["pending_evidence"] == ["Bir kaynak açılamadı."]
        # Editör yeniden karar verir; yeni karar öncekinin yerine geçer, eskisi geçmişte kalır.
        t = _batch(c, ["fact_editorial|BUR-9001-F001"], clock)
        r = c.post("/internal/review/batch/decisions", headers=REVIEW, json={
            "ticket_id": t["ticket_id"], "rationale": "Düzeltilmiş kaydı kaynaklarıyla yeniden inceledim.",
            "items": [{"key": "fact_editorial|BUR-9001-F001", "decision": "approved", "source_check": "verified_on_page"}]})
        assert r.status_code == 200 and r.json()["recorded"] == 1
        history = c.get("/internal/review/subjects/fact/BUR-9001-F001", headers=REVIEW).json()["history"]
        assert [h["decision"] for h in history] == ["needs_revision", "approved"]
        assert history[0] == first and history[1]["supersedes"] == first["decision_id"]
        listing = c.get("/internal/review/batch", headers=REVIEW).json()
        (item,) = [i for st in listing["stages"] if st["decision_type"] == "fact_editorial" for i in st["items"]]
        assert item["done"] and item["revision"]["open"] is False


def test_batch_rejects_short_rationale_and_unknown_items(env):
    clock = Clock()
    with make_client(env, clock, **setup_files(env)) as c:
        login(c, env, "editor")
        t = _batch(c, ["catalog_identity|BUR-9001"], clock)
        r = c.post("/internal/review/batch/decisions", headers=REVIEW, json={
            "ticket_id": t["ticket_id"], "rationale": "kısa", "items": [{"key": "catalog_identity|BUR-9001", "decision": "rejected"}]})
        assert r.status_code == 422
        t = _batch(c, ["catalog_identity|BUR-9001"], clock)
        r = c.post("/internal/review/batch/decisions", headers=REVIEW, json={
            "ticket_id": t["ticket_id"], "rationale": "Bilet dışı kayıt denemesi.",
            "items": [{"key": "fact_editorial|BUR-9001-F001", "decision": "approved"}]})
        assert r.status_code == 422


def test_shared_token_cannot_batch(env):
    clock = Clock()
    with make_client(env, clock, **setup_files(env)) as c:
        login(c, env)
        r = c.post("/internal/review/batch/tickets", headers=REVIEW, json={"keys": ["catalog_identity|BUR-9001"]})
        assert r.status_code in (401, 403)


# --- Commons görselleri ve genel oyun -------------------------------------------------------

def publish_all(env, clock, tmp_path, checkin=False):
    files = setup_files(env)
    with make_client(env, clock, **files) as c:
        login(c, env, "editor")
        assert decide(c, clock, "monument", "BUR-9001", "catalog_identity", source_check="verified_on_page",
                      payload=IDENTITY).status_code == 201
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_editorial", source_check="verified_on_page").status_code == 201
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_publication", payload=PUBLISH).status_code == 201
        assert decide(c, clock, "fact", "BUR-9001-F001", "fact_game_use", payload=QUIZ).status_code == 201
        login(c, env, "rights")
        listing = c.get("/internal/review/batch", headers=REVIEW).json()
        rights = next(st for st in listing["stages"] if st["decision_type"] == "image_rights")["items"][0]
        assert rights["allowed"] and rights["payload"]["license"] == "CC-BY-SA-4.0"
        img = "commons/BUR-9001/abc"
        assert decide(c, clock, "image", img, "image_rights", payload=rights["payload"]).status_code == 201
        assert decide(c, clock, "image", img, "image_publication").status_code == 201
        out = tmp_path / "public" / "catalog.json"
        out.parent.mkdir()
        write_snapshot(c.app.state.review, out, env["root"] / "images" / "monuments", "test",
                       commons_dir=env["root"] / "images" / "commons")
    return out


def test_commons_image_published_with_attribution_and_card(env, tmp_path):
    out = publish_all(env, Clock(), tmp_path)
    (m,) = json.loads(out.read_text())["monuments"]
    (img,) = m["images"]
    assert img["license"] == "CC-BY-SA-4.0" and "Test Fotoğrafçı" in img["attribution"]
    assert img["license_url"] == "https://creativecommons.org/licenses/by-sa/4.0/"
    assert (out.parent / "media" / img["file"]).read_bytes() == b"KURGUSAL-AYRINTI"
    assert (out.parent / "media" / img["card_file"]).read_bytes() == b"KURGUSAL-KART"
    # Hak kararı olmayan V20 arşiv görseli yayına geçmez.
    assert not any("BUR-9001_test" in i["image_id"] for i in m["images"])


def test_quests_hide_answer_and_knowledge_seal_is_awarded_once(env, tmp_path):
    out = publish_all(env, Clock(), tmp_path)
    progress_db = tmp_path / "progress" / "p.sqlite3"
    with TestClient(create_app(public_catalog_file=out, demo_api=False, progress_db=progress_db)) as c:
        summary = c.get("/monuments").json()["monuments"][0]
        assert summary["quest_count"] == 1 and summary["cover"]["file"]
        detail = c.get("/monuments/BUR-9001").json()
        assert "answer_index" not in json.dumps(detail)
        quests = c.get("/monuments/BUR-9001/quests").json()["quests"]
        assert quests[0]["choices"] == QUIZ["choices"] and "answer_index" not in quests[0]

        wrong = c.post("/monuments/BUR-9001/quests/BUR-9001-F001/answer", json={"user_id": "u-1", "choice_index": 1}).json()
        assert wrong["correct"] is False and wrong["explanation"] is None and wrong["knowledge_seal"] is None
        right = c.post("/monuments/BUR-9001/quests/BUR-9001-F001/answer", json={"user_id": "u-1", "choice_index": 0}).json()
        assert right["correct"] is True and right["knowledge_seal"]["new"] is True
        again = c.post("/monuments/BUR-9001/quests/BUR-9001-F001/answer", json={"user_id": "u-1", "choice_index": 0}).json()
        assert again["already_solved"] is True and again["knowledge_seal"]["new"] is False
        seals = c.get("/users/u-1/seals").json()
        assert [s["kind"] for s in seals["knowledge_seals"]] == ["knowledge"] and seals["visit_seals"] == []

        # GPS check-in onayı olmayan eserde fiziksel ziyaret mührü kazanılamaz.
        r = c.post("/monuments/BUR-9001/check-in", json={"user_id": "u-1", "latitude": 40.1841, "longitude": 29.0621})
        assert r.status_code == 409
        assert c.get("/users/u-1/seals").json()["visit_seals"] == []
        assert c.post("/monuments/BUR-9001/quests/BUR-9001-F999/answer",
                      json={"user_id": "u-1", "choice_index": 0}).status_code == 404

    # İlerleme yeniden başlatmada korunur.
    with TestClient(create_app(public_catalog_file=out, demo_api=False, progress_db=progress_db)) as c:
        assert len(c.get("/users/u-1/seals").json()["knowledge_seals"]) == 1


def test_progress_store_never_duplicates_seals(tmp_path):
    s = MonumentProgressStore(tmp_path / "p.sqlite3")
    assert s.add_seal("u", "BUR-0001", "Ulu Cami", "knowledge")[1] is True
    assert s.add_seal("u", "BUR-0001", "Ulu Cami", "knowledge")[1] is False
    assert s.add_seal("u", "BUR-0001", "Ulu Cami", "visit")[1] is True
    assert sorted(x["kind"] for x in s.seals("u")) == ["knowledge", "visit"]


def test_batch_submission_republishes_public_snapshot(env, tmp_path):
    clock = Clock()
    out = tmp_path / "pub" / "catalog.json"
    with make_client(env, clock, publish_out=out, **setup_files(env)) as c:
        login(c, env, "editor")
        keys = ["catalog_identity|BUR-9001", "fact_editorial|BUR-9001-F001", "fact_publication|BUR-9001-F001"]
        t = _batch(c, keys, clock)
        r = c.post("/internal/review/batch/decisions", headers=REVIEW, json={
            "ticket_id": t["ticket_id"], "rationale": "Kaynak sayfalarını tek tek açıp kontrol ettim.",
            "items": [{"key": keys[0], "decision": "approved", "source_check": "verified_on_page", "payload": IDENTITY},
                      {"key": keys[1], "decision": "approved", "source_check": "verified_on_page"},
                      {"key": keys[2], "decision": "approved", "payload": PUBLISH}]})
        assert r.status_code == 200 and r.json()["publication"] == {"published": True, "monuments": 1, "facts": 1, "images": 0}
        (m,) = json.loads(out.read_text())["monuments"]
        assert m["facts"][0]["text"] == ORIGINAL
        # Elle yenileme de yalnızca kişisel hesapla yapılır.
        login(c, env)
        assert c.post("/internal/review/publish", headers=REVIEW).status_code in (401, 403)
