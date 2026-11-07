"""R6.17: eksiksiz İngilizce. Soru çevirisi Türkçe sorunun kimliğine ve doğru cevabına bağlı; eserin diğer adları ve
adresi; İngilizce taslak dosyasının bütünlüğü; aktarım betiği varsayılan olarak yayımlamaz; İngilizce rehber eseri
sorudaki adından tanır; İngilizce fotoğraf yolu güvenlik kurallarını korur; hesap e-postaları seçilen dilde gider."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import mailer
from app.main import create_app
from tests.test_content import ADMIN, PAGES, SNAPSHOT, add_source, env, login_admin, make_pdf  # noqa: F401  (env: autouse)

ROOT = Path(__file__).resolve().parents[1]
DRAFTS = ROOT / "content_drafts" / "bursa_en_r617.json"
EN_PAGES = PAGES + ["The Grand Mosque was commissioned by Sultan Yildirim Bayezid and completed in 1399 with twenty domes.\n"
                    "Its minbar door carries a wooden inscription dated to the year 802 of the Hijri calendar."]
QUEST_EN = {"question": "Which sultan commissioned the Bursa Grand Mosque?",
            "choices": ["Murad II", "Mehmed II (the Conqueror)", "Yildirim Bayezid", "Orhan Gazi"],
            "explanation": "The Grand Mosque was built under Yildirim Bayezid."}


@pytest.fixture
def c(tmp_path):
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False, content_dir=tmp_path / "content")) as client:
        client.app.state.content_pipeline._pool = None
        yield client


def en_body(sid, **over):
    return {"title_en": "Yildirim Bayezid's mosque", "text_en": "Sultan Yildirim Bayezid commissioned the mosque; it was completed in 1399.",
            "source_id": sid, "page": 4, "quote_en": "commissioned by Sultan Yildirim Bayezid and completed in 1399",
            "quest_en": QUEST_EN, "publish": False, **over}


def catalog_fact(c, fid="BUR-0001-F001"):
    return next(f for f in c.get("/monuments/BUR-0001").json()["facts"] if f["fact_id"] == fid)


def test_question_translation_is_bound_to_the_turkish_question(c):
    login_admin(c)
    sid = add_source(c, pages=EN_PAGES, title="İki dilli envanter")
    t = c.put("/admin/content/facts/BUR-0001-F001/en", json=en_body(sid, note="Kitapla fark yok.")).json()
    assert t["status"] == "draft" and t["quest_en"] == QUEST_EN and t["note"] == "Kitapla fark yok."
    assert t["fact_quest"]["choices"] == ["II. Murad", "Fatih Sultan Mehmed", "Yıldırım Bayezid", "Orhan Gazi"]
    assert "answer_index" not in t["fact_quest"]  # doğru cevap yönetici ekranına da çeviriye de girmez
    assert c.post("/admin/content/facts/BUR-0001-F001/en/publish").json()["status"] == "published"
    q = c.app.state.monuments.get("BUR-0001").facts[0].quest
    assert q.question_en == QUEST_EN["question"] and list(q.choices_en) == QUEST_EN["choices"]
    assert q.answer_index == 2 and q.choices[2] == "Yıldırım Bayezid" and q.choices_en[2] == "Yildirim Bayezid"
    assert q.question == "Bursa Ulu Cami'yi hangi padişah yaptırmıştır?"  # Türkçe soru değişmez
    # Genel uç doğru cevabı göstermez.
    assert "answer_index" not in json.dumps(c.get("/monuments/BUR-0001").json())


def test_question_translation_rules(c):
    login_admin(c)
    sid = add_source(c, pages=EN_PAGES)
    short = {**QUEST_EN, "choices": QUEST_EN["choices"][:3]}
    r = c.put("/admin/content/facts/BUR-0001-F001/en", json=en_body(sid, quest_en=short))
    assert r.status_code == 400 and "aynı" in r.json()["detail"]
    dup = {**QUEST_EN, "choices": ["Murad II", "murad ii", "Orhan Gazi", "Osman"]}
    assert c.put("/admin/content/facts/BUR-0001-F001/en", json=en_body(sid, quest_en=dup)).status_code == 400
    # BUR-0001-F002'nin Türkçe sorusu yok: İngilizce soru eklenemez, metin çevirisi eklenebilir.
    assert c.put("/admin/content/facts/BUR-0001-F002/en", json=en_body(sid)).status_code == 400
    assert c.put("/admin/content/facts/BUR-0001-F002/en", json=en_body(sid, quest_en=None)).status_code == 200


def test_monument_english_alternative_names_and_address(c):
    login_admin(c)
    body = {"name_en": "Bursa Grand Mosque", "alternative_names_en": ["Ulu Cami", "Ulucami"],
            "address_en": "Atatürk Caddesi, Osmangazi/Bursa (opposite the PTT post office)", "publish": False}
    r = c.put("/admin/content/monuments/BUR-0001/en", json=body).json()
    assert r["status"] == "draft"
    m = c.get("/monuments/BUR-0001").json()
    assert m["name_en"] is None and m["alternative_names_en"] == [] and m["address_en"] is None  # taslak görünmez
    assert c.put("/admin/content/monuments/BUR-0001/en", json={**body, "publish": True}).status_code == 200
    m = c.get("/monuments/BUR-0001").json()
    assert m["alternative_names_en"] == ["Ulu Cami", "Ulucami"] and m["address_en"].startswith("Atatürk Caddesi")
    assert m["alternative_names"] == ["Ulu Cami"] and m["address"].startswith("Atatürk Caddesi")  # Türkçe aynen


def test_language_switch_does_not_touch_seals_or_progress(c):
    """Dil, ilerleme ve mühürden bağımsızdır: bilgi mührü olan eserde İngilizce görev de açılmaz (ikinci mühür/XP yok)."""
    uid = c.post("/auth/register", json={"email": "kurgu@example.invalid", "password": "kurgu-parola-1"}).json()["user_id"]
    c.app.state.monument_progress.add_seal(uid, "BUR-0001", "Bursa Ulu Camii", "knowledge")
    for lang in ("en", "tr"):
        assert c.post("/monuments/BUR-0001/quiz", json={"user_id": uid, "lang": lang}).status_code == 409
    seals = c.get(f"/users/{uid}/seals").json()["knowledge_seals"]
    assert [s["monument_id"] for s in seals] == ["BUR-0001"]


# --- Taslak dosyası -------------------------------------------------------------------------------------------------


def test_english_draft_file_is_complete_and_bound_to_catalog_ids():
    drafts = json.loads(DRAFTS.read_text(encoding="utf-8"))
    catalog = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    facts = {f["fact_id"]: f for m in catalog["monuments"] for f in m["facts"]}
    assert drafts["schema"] == "vakifname.en_drafts/1" and drafts["status"] == "draft"
    assert sorted(f["fact_id"] for f in drafts["facts"]) == sorted(facts)  # her kayıt ya taslaklı ya gerekçeyle atlanmış
    assert {m["monument_id"] for m in drafts["monuments"]} == {m["monument_id"] for m in catalog["monuments"]}
    for f in drafts["facts"]:
        tr = facts[f["fact_id"]]
        if f.get("skip"):
            assert len(f["skip"]) > 30 and not f.get("text_en")
            continue
        assert len(f["quote_en"].split()) >= 6 and abs(f["page"] - tr["source"]["pdf_physical_page"]) <= 1
        assert f["source"] in drafts["sources"]
        # Metindeki her sayı alıntıda geçer (rehberin İngilizce sayı denetimiyle aynı kural).
        import re
        assert set(re.findall(r"\d+", f["text_en"])) <= set(re.findall(r"\d+", f["quote_en"])), f["fact_id"]
        if tr.get("quest"):
            assert len(f["quest_en"]["choices"]) == len(tr["quest"]["choices"]), f["fact_id"]
            assert "answer_index" not in f["quest_en"]
        else:
            assert not f.get("quest_en")
    assert not any("demo" in json.dumps(m, ensure_ascii=False).lower() for m in drafts["monuments"])


def test_import_script_writes_drafts_only_by_default(tmp_path):
    """Aktarım betiği, kitap özetini eşler; `--publish-local-test` verilmezse hiçbir şey yayımlanmaz."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("imp", ROOT / "scripts" / "import_english_drafts.py")
    imp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(imp)
    import hashlib
    pdf = make_pdf(EN_PAGES)
    (tmp_path / "book.pdf").write_bytes(pdf)
    drafts = {"schema": imp.SCHEMA, "sources": {"cilt-1": {"title": "Test", "file": "book.pdf",
                                                           "sha256": hashlib.sha256(pdf).hexdigest()}},
              "monuments": [{"monument_id": "BUR-0001", "name_en": "Bursa Grand Mosque", "site_notice_en": None,
                             "alternative_names_en": ["Ulu Cami"], "address_en": None}],
              "facts": [{"fact_id": "BUR-0001-F001", "source": "cilt-1", "page": 4,
                         "quote_en": "commissioned by Sultan Yildirim Bayezid and completed in 1399",
                         "title_en": "Yildirim Bayezid's mosque", "text_en": "Sultan Yildirim Bayezid commissioned it.",
                         "quest_en": QUEST_EN, "note": "not"},
                        {"fact_id": "BUR-0001-F002", "skip": "İngilizce bölümde karşılığı yok (test)."}]}
    catalog = imp.load_catalog(SNAPSHOT)
    counts = imp.run(tmp_path / "depo", catalog, drafts, {"cilt-1": tmp_path / "book.pdf"}, True, False)
    assert counts == {"facts": 1, "quests": 1, "skipped": 1, "monuments": 1, "errors": []}
    overlay = json.loads((tmp_path / "depo" / "published.json").read_text(encoding="utf-8"))
    assert overlay["translations"] == [] and overlay["monument_en"] == []
    # Aynı depoya ikinci aktarım kaynağı yeniden eklemez (özetle eşlenir); yerel test yayını açık bayrakla olur.
    counts = imp.run(tmp_path / "depo", catalog, drafts, {}, True, True)
    overlay = json.loads((tmp_path / "depo" / "published.json").read_text(encoding="utf-8"))
    assert counts["errors"] == [] and overlay["translations"][0]["quest_en"]["choices"] == QUEST_EN["choices"]
    # Kitap özeti tutmazsa durur.
    bad = {**drafts, "sources": {"cilt-1": {**drafts["sources"]["cilt-1"], "sha256": "0" * 64}}}
    with pytest.raises(SystemExit):
        imp.run(tmp_path / "depo2", catalog, bad, {"cilt-1": tmp_path / "book.pdf"}, True, False)


# --- Rehber ---------------------------------------------------------------------------------------------------------


@pytest.fixture
def guide(c):
    login_admin(c)
    c.put("/admin/content/monuments/BUR-0001/en", json={"name_en": "Bursa Grand Mosque", "publish": True})
    c.put("/admin/content/monuments/BUR-0019/en", json={"name_en": "Tomb of Osman Gazi", "publish": True})
    c.put("/admin/content/monuments/BUR-0003/en", json={"name_en": "Muradiye Mosque", "publish": True})
    c.put("/admin/content/monuments/BUR-0005/en", json={"name_en": "Muradiye Madrasa", "publish": True})
    from app.guide.service import GuideService
    return next(v for v in vars(c.app.state)["_state"].values() if isinstance(v, GuideService))


@pytest.mark.parametrize("question,expected", [
    ("Who commissioned the Bursa Grand Mosque?", "BUR-0001"),
    ("When was the Grand Mosque completed?", "BUR-0001"),
    ("Bursa Ulu Camii'ni kim yaptırdı?", "BUR-0001"),
    ("Tell me about Osman Gazi's tomb", "BUR-0019"),
    ("Is the Muradiye Mosque older than the Muradiye Madrasa?", None),  # iki eser: seçilmez
    ("What is a madrasa?", None),
    ("Hello", None),
])
def test_english_guide_recognises_the_named_monument(guide, question, expected):
    m = guide._named_monument_en(question)
    assert (m.monument_id if m else None) == expected


def test_english_guide_without_monument_asks_which_one(guide):
    from app.guide.service import Usage
    res = guide._answer_en("Who built it?", None, [], Usage(deadline=1e18))
    assert res["status"] == "monument_not_identified" and "Bursa Grand Mosque" in res["message"]


def test_english_photo_messages_cover_the_turkish_photo_path():
    from app.guide import service as s
    assert s.NOT_MATCHED in s.EN_MESSAGES
    for reason in s.PHOTO_FAILED_REASON.values():
        if f"Fotoğraf analiz edilemedi. {reason}" not in s.EN_MESSAGES:
            pytest.fail(f"İngilizcesi yok: {reason}")
    # İngilizce gözlem denetimi: üslup/dönem atfı ve kesin yargı düşer, çekinceli malzeme izlenimi kalır.
    assert s._STYLE_EN.search(s.fold("An Ottoman style dome")) and s._DEFINITIVE_EN.search(s.fold("This is definitely fake"))
    assert s._HEDGE_EN.search(s.fold("The walls appear to be stone"))
    assert s._visible_parts_en("A dome and a minaret") == {"kubbe", "minare"}


# --- E-posta --------------------------------------------------------------------------------------------------------


def test_account_emails_follow_the_interface_language():
    s, text, html = mailer.verification_mail("https://ornek.invalid", "a" * 43, 24, "en")
    assert s == "VAKIFNAME: verify your email address" and "valid for 24 hours" in text and '<html lang="en">' in html
    assert "#t=" + "a" * 43 in text  # bağlantı dilden bağımsız
    s, text, html = mailer.reset_mail("https://ornek.invalid", "b" * 43, 30, "en")
    assert s == "VAKIFNAME: password reset" and "30 minutes" in text
    s, text, _ = mailer.verification_mail("https://ornek.invalid", "a" * 43, 24)
    assert s == "VAKIFNAME: e-posta adresinizi doğrulayın" and "Merhaba" in text  # varsayılan Türkçe aynen


def test_register_and_reset_accept_language(c):
    sent = []
    c.app.state.mailer = type("M", (), {"name": "test", "send": lambda self, to, s, t, h: sent.append(s)})()
    c.post("/auth/register", json={"email": "en@example.invalid", "password": "kurgu-parola-1", "lang": "en"})
    c.post("/auth/password-reset/request", json={"email": "en@example.invalid", "lang": "en"})
    assert sent == ["VAKIFNAME: verify your email address", "VAKIFNAME: password reset"]
    assert c.post("/auth/register", json={"email": "x@example.invalid", "password": "kurgu-parola-1", "lang": "de"}).status_code == 422
