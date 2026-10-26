"""Görev 32 devam: gerçek NVIDIA Nemotron çıktılarıyla regresyon testleri (sahte sağlayıcıyla, ağsız).

`tests/data/g32_nvidia_outputs.json`, gerçek testte modelin döndürdüğü değiştirilmemiş JSON metnidir (görsel yok). Her
senaryo şu ölçütlerle ayrı ayrı sınanır:

- yanlış cümlelerin engellenmesi (çekincesiz/çelişen malzeme, bozuk sözcük),
- doğru gözlemlerin korunması ("taş levha", "kaligrafik panel", "paye", kubbe cümlesi),
- Türkçe anlatım bütünlüğü (gösterilen metinde bozuk sözcük ve tamlama yok),
- bağlam kopması ("Üzerinde…", "içinde…" gibi sahipsiz devam yok),
- tarihî bilgi uydurma (tarih, kişi, üslup yok),
- yanlış eser eşleşmesi (orta benzerlik ve açık sayfa fotoğrafa kimlik atamaz).
"""

import copy
import json
import re
from pathlib import Path

import pytest

from app.ask.text import fold
from app.guide.lexicon import TurkishLexicon, correct
from app.guide.observation import clauses, dangling, drop_word, repeats
from app.guide.provider import ProviderError
from app.guide.prompts import FOLLOWUP_SYSTEM, VISION_SYSTEM
from app.guide.service import NEEDS_PHOTO, NO_NEW_DETAIL, NOT_VERIFIED, PHOTO_FAILED
from tests.test_guide import VISION_MODELS, _jpeg, make_service

DATA = json.loads((Path(__file__).parent / "data" / "g32_nvidia_outputs.json").read_text(encoding="utf-8"))
REAL = DATA["outputs"]
SCENARIOS = DATA["scenarios"]
BAD_WORDS = ("darbelemeli", "medallon", "dikmeşer", "avla ", "avla.", "dokuyu", "kesme tahta")


@pytest.fixture(scope="module")
def lex():
    pytest.importorskip("zeyrek")
    lexicon = TurkishLexicon(background=False)
    assert lexicon.state == "ready"
    return lexicon


def analyze(name, lex, obs=None, page=None, question=None):
    """Gerçek gözlemi tam `GuideService.ask` akışından geçirir. (yanıt, düşen ifadeler, sağlayıcı çağrıları)."""
    removed, calls = [], []
    observation = obs if obs is not None else REAL[name]

    def responder(model, messages):
        calls.append("vision" if isinstance(messages[-1]["content"], list) else "text")
        return json.dumps(observation, ensure_ascii=False)
    svc, _ = make_service(responder, models=VISION_MODELS)
    svc.lexicon, svc.on_removed = lex, removed.extend
    r = svc.ask(question or SCENARIOS[name]["question"], page, image_bytes=_jpeg())
    return r, removed, calls


def shown_text(r) -> str:
    p = r["photo"] or {}
    return " ".join([p.get("description", ""), *p.get("features", []), r["message"],
                     *(s["text"] for s in r["sentences"])])


def assert_clean_turkish(r, lex):
    text = shown_text(r)
    for w in BAD_WORDS:
        assert w not in text, w
    assert lex.unknown_words(text) == [] and lex.grammar_issues(text) == []


def assert_no_dangling_start(description):
    for s in re.split(r"(?<=[.!?])\s+", description):
        assert not re.match(r"(Üzerinde|İçinde|içinde|Altında|Bunlar|Bunun|Onun)\b", s), s


# --- B: Ulu Cami iç mekânı ------------------------------------------------------------------------------------------

def test_b_keeps_dome_sentence_and_calligraphy_while_fixing_broken_words(lex):
    r, removed, calls = analyze("B_ulu_cami_ic", lex)
    d = r["photo"]["description"]
    # Doğru gözlemler korunur: önceden "medallon" yüzünden bütün kubbe cümlesi, "kaligrafik" yüzünden panel düşüyordu.
    assert "Merkezde geniş bir kubbe ve yanlarında daha küçük kubbeler yer alıyor." in d
    assert "geometrik bir madalyon" in d and "kaligrafik bir panel" in d
    assert "kalın dikme/paye" in r["photo"]["features"] and "kaligrafik panel" in r["photo"]["features"]
    # Türkçe: bozuk sözcük yalnızca sıfat dizisinden çıkarıldı, yazım düzeltildi; başka sözcük eklenmedi.
    assert_clean_turkish(r, lex)
    assert set(fold(d).split()) <= set(fold(correct(REAL["B_ulu_cami_ic"]["description"])).split())
    assert removed == []
    # Eşleşme yok: kimlik doğrulanmadı, tarihî kayıt çağrısı yapılmadı.
    assert r["status"] == "photo_analyzed" and r["message"] == NOT_VERIFIED and calls == ["vision"]
    assert r["monument"] is None and r["facts"] == [] and r["photo"]["candidates"] == []


# --- C: Muradiye Camii dış cephesi ----------------------------------------------------------------------------------

def test_c_wrong_material_is_not_shown_even_with_benzeri(lex):
    r, removed, _ = analyze("C_muradiye_dis", lex)
    d = r["photo"]["description"]
    # Yanlış malzeme: "kesme tahta benzeri" çekince sayılmaz ve modelin kendi tahminiyle (taş ve tuğla) çelişir.
    assert "tahta" not in shown_text(r) and "ahşap" not in shown_text(r)
    assert {"text": "Cephe, kirişli ve kesme tahta benzeri malzemelerle kaplanmış görünür.",
            "reason": "çekincesiz malzeme"} in removed
    # Çekincesiz malzeme etiketi de gösterilmez; malzeme güvenilir değilse ayrıntı atlanır.
    assert "taş ve tuğla cephe" not in r["photo"]["features"] and r["photo"]["material_guess"] == ""
    # Bozuk tamlama ("duvarın dokuyu") gösterilmez; doğru gözlemler kalır.
    assert any(x["reason"] == "bozuk tamlama" for x in removed)
    for kept in ("yüksek bir minare ve birden fazla kubbedir", "sivri kemerli kapı ve pencereler", "tek minare"):
        assert kept in shown_text(r)
    assert_clean_turkish(r, lex)
    assert r["photo"]["candidates"] == [] and r["monument"] is None


def test_c_contradicting_hedged_material_is_dropped_but_consistent_one_is_kept(lex):
    obs = copy.deepcopy(REAL["C_muradiye_dis"])
    obs["description"] += " Cephe kesme tahtaya benziyor. Duvarlar taş ve tuğla sıralarına benziyor."
    r, removed, _ = analyze("C_muradiye_dis", lex, obs=obs)
    d = r["photo"]["description"]
    assert "tahtaya benziyor" not in d                         # çekinceli ama kendi tahminiyle çelişiyor
    assert "Duvarlar taş ve tuğla sıralarına benziyor." in d   # çekinceli ve material_guess ile tutarlı
    assert {"text": "Cephe kesme tahtaya benziyor.", "reason": "modelin kendi malzeme tahminiyle çelişen malzeme"} in removed


@pytest.mark.parametrize("page", [None, "BUR-0003"])
def test_c_historical_question_without_verified_identity_invents_nothing(lex, page):
    r, _, calls = analyze("C_muradiye_dis", lex, page=page, question="Bu cami ne zaman ve kim tarafından yapıldı?")
    # Fotoğraf eşleşmedi: açık sayfa bile olsa tarihî kayıt fotoğrafın cevabı gibi gösterilmez, çağrı yapılmaz.
    assert r["status"] == "photo_analyzed" and calls == ["vision"]
    assert r["facts"] == [] and r["sentences"] == [] and r["monument"] is None
    assert not re.search(r"\d{3,4}|Murad|Sultan|yaptır", shown_text(r))


def test_c_first_attempt_502_shows_no_fake_analysis(lex):
    svc, provider = make_service(lambda m, msgs: json.dumps(REAL["C_muradiye_dis"]), models=VISION_MODELS,
                                 fail=ProviderError("unavailable", 502))
    svc.lexicon = lex
    r = svc.ask(SCENARIOS["C_muradiye_dis"]["question"], "BUR-0003", image_bytes=_jpeg())
    assert r["status"] == "photo_analysis_failed" and r["message"] == f"{PHOTO_FAILED} Yeniden deneyebilirsiniz."
    assert r["photo"] is None and r["facts"] == [] and r["monument"] is None and len(provider.calls) == 1


# --- D: katalog dışı Yıldırım Bayezid Camii ------------------------------------------------------------------------

@pytest.mark.parametrize("page", [None, "BUR-0005", "BUR-0001"])
def test_d_off_catalog_building_is_never_matched(lex, page):
    r, _, _ = analyze("D_yildirim_katalog_disi", lex, page=page)
    # Model BUR-0005'i (Yeşil Medrese) "orta" benzerlikle yazmıştı: öneri olarak da gösterilmez.
    assert r["photo"]["candidates"] == [] and r["monument"] is None and r["options"] == []
    assert r["message"] == NOT_VERIFIED and "Medrese" not in shown_text(r) and "Yıldırım" not in shown_text(r)


def test_d_drops_only_the_bad_clause_and_its_dangling_continuation(lex):
    r, removed, _ = analyze("D_yildirim_katalog_disi", lex)
    d = r["photo"]["description"]
    reasons = {x["text"]: x["reason"] for x in removed}
    # "dikmeşer" sıfat dizisinden çıkarıldı; cümlenin geri kalanı korundu.
    assert "kalın taşıyıcılarla destekleniyor" in d and "dikmeşer" not in d
    # "avla" → "avlu" (yalnızca yazım düzeltmesi).
    assert "açık bir avlu gibi duruyor" in d and "açık avlu" in r["photo"]["features"]
    # Çekincesiz yapı malzemesi düşer; ona bağlı "içinde …" devamı bağlam kopması olarak düşer.
    assert reasons["Sağdaki duvar, karışık taş ve tuğla düzeniyle yapılmış"] == "çekincesiz malzeme"
    assert reasons["içinde iki farklı boyutta, sivri kemerli pencereler var."] == "bağlam kopması"
    assert "tuğla" not in d and "içinde iki" not in d
    assert_no_dangling_start(d)
    assert_clean_turkish(r, lex)


# --- E: Bedesten, ayakta yazı levhası -------------------------------------------------------------------------------

def test_e_visible_stone_plaque_is_kept_and_wall_material_is_not(lex):
    r, removed, _ = analyze("E_bedesten_ayrinti", lex)
    d = r["photo"]["description"]
    # Görülen nesne betimlemesi: önceden "gömülü" (defin) ve "taş" (malzeme) yüzünden düşüyordu.
    assert "Merkezde, duvara gömülü dikdörtgen bir taş levha yer alıyor." in d
    assert "Üzerinde koyu renkli, el yazısı tarzında hat süslemesi bulunuyor." in d
    assert "dikdörtgen taş levha" in r["photo"]["features"]
    # Aynı cümlenin bağımsız ilk yan cümlesi kalır; duvarın malzemesine dair çekincesiz yan cümle düşer.
    assert "Levhanın çevresinde hafif bir kenarlık var." in d
    assert "tuğla" not in d and "tuğla veya kesme taşlı duvar" not in r["photo"]["features"]
    assert [x["reason"] for x in removed if x["reason"] != "özellik"] == ["çekincesiz malzeme"]
    # Tek ayrıntı: bina hakkında yorum yok, kimlik yok.
    assert "minare" not in d and "kubbe" not in d and r["photo"]["candidates"] == []
    assert r["photo"]["identity"]["identifiable"] == "no"
    # "Üzerinde…" kalır: gönderme yaptığı levha cümlesi hemen öncesinde gösteriliyor.
    assert d.index("taş levha yer alıyor.") < d.index("Üzerinde koyu renkli")
    assert_clean_turkish(r, lex)


def test_e_when_the_plaque_sentence_is_dropped_its_continuations_are_dropped_too(lex):
    # "Mermer levha" fotoğraftan doğrulanamayan özgül malzemedir; o cümle düşünce "Üzerinde…" ve "Levhanın…" sahipsiz
    # kalır ve gösterilmez. Kalan açıklama kısa ama anlamlıdır; eksik gönderme yeni sözcükle onarılmaz.
    obs = copy.deepcopy(REAL["E_bedesten_ayrinti"])
    obs["description"] = obs["description"].replace("dikdörtgen bir taş levha", "dikdörtgen bir mermer levha")
    obs["features"] = ["duvar", "hat süslemesi"]
    r, removed, _ = analyze("E_bedesten_ayrinti", lex, obs=obs)
    d = r["photo"]["description"]
    assert "levha" not in fold(d) and "Üzerinde" not in d
    assert [x["reason"] for x in removed] == ["çekincesiz malzeme", "bağlam kopması", "bağlam kopması",
                                              "çekincesiz malzeme"]
    assert d.startswith("Fotoğraf, duvarın bir kısmını yakından gösteren") and "yorum yapılamıyor" in d


def test_e_invented_history_in_a_clause_is_removed_and_the_rest_kept(lex):
    obs = copy.deepcopy(REAL["E_bedesten_ayrinti"])
    obs["description"] += (" Levhada hat yazısı var ve levha 1490 yılında Sultan Bayezid tarafından yerleştirilmiştir."
                           " Bu levha erken Osmanlı üslubundadır.")
    r, removed, _ = analyze("E_bedesten_ayrinti", lex, obs=obs)
    d = r["photo"]["description"]
    assert "Levhada hat yazısı var." in d
    assert not re.search(r"1490|Sultan|Bayezid|Osmanlı|üslub|yerleştirilmiş", shown_text(r))
    history = [x for x in removed if "1490" in x["text"] or "Osmanlı" in x["text"]]
    assert len(history) == 2 and history[0]["reason"] == "fotoğraftan tarih/sayı"


# --- Takip soruları -------------------------------------------------------------------------------------------------

def _followup(lex, reply, src="B_ulu_cami_ic", question=None, name="B_takip_kubbe"):
    first, _, _ = analyze(src, lex)
    ctx = {"description": first["photo"]["description"], "features": first["photo"]["features"]}
    calls = []
    svc, _ = make_service(lambda m, msgs: calls.append(msgs) or json.dumps(reply, ensure_ascii=False),
                          models=VISION_MODELS)
    svc.lexicon = lex
    return svc.ask(question or SCENARIOS[name]["question"], None, photo_context=ctx), calls


def test_followup_that_only_repeats_the_analysis_is_not_presented_as_new(lex):
    r, calls = _followup(lex, REAL["B_takip_kubbe"])
    # Gerçek çıktı önceki analizin cümlelerini kelimesi kelimesine döndürmüştü.
    assert r["status"] == "photo_context_needed" and r["message"] == NO_NEW_DETAIL and r["sentences"] == []
    assert r["actions"] == ["upload_another"] and "yeniden yükler" in r["message"]
    assert isinstance(calls[0][-1]["content"], str)  # fotoğraf ikinci çağrıda gönderilmedi


def test_followup_with_general_knowledge_keeps_one_reminder_and_adds_information(lex):
    reply = {"status": "answered", "sentences": [
        {"text": "Fotoğrafta merkezde geniş bir kubbe ve yanlarında daha küçük kubbeler vardı.", "basis": "photo"},
        {"text": "Kubbelerin etrafında küçük, yüksek konumlu pencereler ışık sağlıyor.", "basis": "photo"},  # tekrar
        {"text": "Kubbe, altındaki mekânı ara destek olmadan örten yarım küre biçimli bir örtüdür.", "basis": "general"},
        {"text": "Kubbeler genellikle kasnak denen silindirik bir bölümün üzerine oturur.", "basis": "general"},
        {"text": "Kubbenin yükü kemerler ve pandantifler aracılığıyla payelere aktarılır.", "basis": "general"},
        {"text": "Bu kubbe 1399 yılında tamamlanmıştır.", "basis": "general"},                            # tarih
        {"text": "Fotoğraftaki kubbenin içi altın yaldızlı medallonlarla kaplıdır.", "basis": "photo"}]}   # görülmedi
    r, _ = _followup(lex, reply)
    texts = [s["text"] for s in r["sentences"]]
    assert r["status"] == "photo_followup"
    assert texts[0].startswith("Fotoğrafta merkezde geniş bir kubbe") and r["sentences"][0]["sources"] == ["FOTOGRAF"]
    assert sum(s["sources"] == ["GENEL"] for s in r["sentences"]) == 3
    assert not any("pencereler ışık sağlıyor" in t or "1399" in t or "yaldız" in t for t in texts)
    assert_clean_turkish(r, lex)


def test_followup_needing_unseen_detail_asks_for_the_photo(lex):
    r, _ = _followup(lex, REAL["C_takip_gorulmeyen"], src="C_muradiye_dis", name="C_takip_gorulmeyen")
    assert r["status"] == "photo_context_needed" and r["message"] == NEEDS_PHOTO and r["sentences"] == []


def test_prompts_steer_towards_plain_turkish_and_new_followup_information():
    for term in ("avlu", "madalyon", "paye", "şerefe", "kasnak", "revak", "duvarın dokusunu", "Üzerinde"):
        assert term in VISION_SYSTEM
    assert "material_guess" in VISION_SYSTEM and "benzeri" in VISION_SYSTEM
    assert "tekrar etme" in FOLLOWUP_SYSTEM and "general" in FOLLOWUP_SYSTEM


# --- Yardımcılar ----------------------------------------------------------------------------------------------------

def test_clauses_split_only_at_independent_predicates():
    assert clauses("Levhanın çevresinde hafif bir kenarlık var ve duvar tuğladan.") == [
        "Levhanın çevresinde hafif bir kenarlık var", "duvar tuğladan."]
    assert clauses("Bir kubbe ve yanlarında daha küçük kubbeler yer alıyor; bu kubbeler süslü.") == [
        "Bir kubbe ve yanlarında daha küçük kubbeler yer alıyor", "bu kubbeler süslü."]
    assert clauses("Sivri kemerli kapılar ve pencereler görülüyor.") == ["Sivri kemerli kapılar ve pencereler görülüyor."]


def test_drop_word_only_inside_modifier_lists():
    assert drop_word("Merkezde geniş, darbelemeli bir kubbe var.", "darbelemeli") == "Merkezde geniş bir kubbe var."
    assert drop_word("kalın ve dikmeşer taşıyıcılarla", "dikmeşer") == "kalın taşıyıcılarla"
    assert drop_word("Cephede bir okşu mevcut.", "okşu") is None  # sözcüğün işlevi bilinmiyor: yan cümle düşer


def test_dangling_detects_orphan_references_only():
    removed = "Merkezde dikdörtgen bir mermer levha yer alıyor."
    assert dangling("Üzerinde koyu renkli hat var.", removed, "")
    assert dangling("Levhanın çevresinde kenarlık var.", removed, "Fotoğraf duvarı gösteriyor.")
    assert not dangling("Levhanın çevresinde kenarlık var.", removed, "Bir taş levha görülüyor.")
    assert not dangling("Yapının tamamı görünmüyor.", removed, "")
    assert not dangling("Kubbelerin etrafında pencereler var.", removed, "")


def test_repeats_detects_near_copies():
    prev = ["Kubbelerin etrafında küçük, yüksek konumlu pencereler ışık sağlıyor."]
    assert repeats("Kubbelerin etrafında yüksek konumlu pencereler ışık sağlıyor.", prev)
    assert not repeats("Kubbe, altındaki mekânı örten yarım küre biçimli örtüdür.", prev)


def test_grammar_check_has_no_false_alarms_on_approved_catalog_texts(lex):
    from app.ask.service import AskService
    from app.public_catalog import PublicCatalogRepository
    from tests.test_guide import CATALOG
    docs = AskService(PublicCatalogRepository(CATALOG), background=False).engine().corpus.docs
    assert [d.fact_id for d in docs if lex.grammar_issues(d.text)] == []
    assert lex.grammar_issues("Işık ve gölge, duvarın dokuyu vurgular.") == ["duvarın dokuyu"]
    for ok in ("Caminin avluya açılan kapısı görülüyor.", "Kubbenin kasnak kısmı görünüyor.",
               "Boşluklar kalın taşıyıcılarla destekleniyor.", "Duvarın dokusunu vurgular."):
        assert lex.grammar_issues(ok) == [], ok


def test_domain_terms_are_valid_words(lex):
    for w in ("kaligrafik", "şerefe", "paye", "kasnak", "revak", "madalyon", "pandantif"):
        assert lex.unknown_words(f"Bir {w} görülüyor.") == [], w
    assert lex.unknown_words("Geniş, darbelemeli bir kubbe.") == ["darbelemeli"]
    assert correct("çiçekli bir medallon ve açık avla") == "çiçekli bir madalyon ve açık avlu"
