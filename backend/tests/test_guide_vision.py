"""Görev 23: görsel analiz hatası ve görsel gözlem filtreleri (sahte sağlayıcıyla, ağsız).

Gözlem örneklerinin bir kısmı Görev 22 gerçek Nemotron testinde modelin döndürdüğü JSON'dur (Selimiye: Wikimedia
Commons, Dosseman, CC BY-SA 4.0; Koza Han: katalog fotoğrafı). Görseller değil, yalnızca modelin metin çıktısı kullanılır.
"""

import json
import logging
import os

import httpx
import pytest
from fastapi.testclient import TestClient

from app.guide.budget import CircuitBreaker, DailyBudget
from app.guide.claims import PHOTO_ID, Checker, Sentence
from app.guide.lexicon import TurkishLexicon
from app.guide.provider import ProviderError
from app.guide.service import GuideSettings, _sentences
from app.main import create_app
from tests.test_guide import (CATALOG, GUIDE, KOZA_MATCH, TESTER_KEY, VISION_MODELS, FakeFaceScreen, _completion, _jpeg,
                              _openrouter, _Trickle, answer, make_service)

FAILED_ACTIONS = ["retry_photo", "upload_another", "ask_without_photo"]

# Görev 22 gerçek çıktıları (değiştirilmeden).
REAL_SELIMIYE = {"is_architecture": True, "building_type": "cami", "description": "Görüntüde, iki büyük minare ile çevrili, merkezi büyük bir kubbeye sahip cami görünmektedir. Cephe, kiremit desenli pencereler, kırmızı-beyaz şeritli kemerler ve simetrik olarak düzenlenmiş cami pencereleriyle donatılmıştır. Ön kısmında duvarlar arasında bir yol ve ağaç bulunmaktadır.", "features": ["kubbe", "minare", "kemer", "pencere", "kapı", "duvar", "ağaç"], "architecture_explanation": "Kubbe, caminin ana odasını kapsayan büyük bir üst örtüdür. Minareler, caminin iki yanında yüksek, silindirik kulelerdir. Kemerler, giriş ve pencere girişlerini destekleyen eğri yapılardır. Revaklar, avluyu çevreleyen üstü örtülü geçitlerdir.", "visible_text": "", "identity": {"identifiable": "uncertain", "reason": "Fotoğrafta yapıya özgü bir isim levhası veya belirgin bir işaret bulunmamaktadır; yalnızca mimari özelliklerden yola çıkılarak kesin bir kimlik belirlenememektedir."}, "synthetic_signs": [], "catalog_match": []}  # noqa: E501
REAL_KOZA = {"is_architecture": True, "building_type": "han", "description": "İki katlı, kırmızı ve krem renkli tuğla ile yapılmış bir yapı. Üst katta sıralı, kiremitli kaminler var. Cephede büyük, altın renkli harflerle yazılmış bir levha ve altındaki kapı üzeri bir okşu mevcut. Pencereler demir ızgaralı, kapı girişinde kiremit döşeme var. Yanlarda bitkisel süslemeler ve bilgi panoları yer alıyor.", "features": ["tuğla cephe", "kiremitli kaminler", "altın harfli levha", "okşulu giriş", "demir ızgaralı pencereler", "kiremit döşeme", "bitkisel süslemeler", "bilgi panoları"], "architecture_explanation": "Revak, avluyu çevreleyen üstü örtülü bir geçittir ve burada giriş alanını koruyan bir işlev görür. Okşu, giriş kapısının üzerindeki yay şeklinde yapısal ve süsleyici bir öğedir. Demir ızgaralı pencereler, içeri ışık geçirirken güvenlik sağlar. Tuğla döşeme, giriş yolunun dayanıklı ve temiz tutulmasını sağlar.", "visible_text": "KOZA HAN", "identity": {"identifiable": "yes", "reason": "Büyük ve net harflerle yazılmış 'KOZA HAN' levhası, yapının kimliğini doğrudan göstermektedir."}, "synthetic_signs": [], "catalog_match": [{"monument_id": "BUR-0009", "likelihood": "high", "reason": "Fotoğraftaki 'KOZA HAN' yazısı, katalogdaki BUR-0009 kaydıyla doğrudan ve açık bir şekilde eşleşmektedir."}]}  # noqa: E501


def _vlm(obs, calls=None, answer_fn=None):
    def responder(model, messages):
        is_vision = isinstance(messages[-1]["content"], list)
        if calls is not None:
            calls.append(("vision" if is_vision else "answer", messages))
        if is_vision:
            return json.dumps(obs, ensure_ascii=False)
        return answer_fn(messages) if answer_fn else answer(("Koza Han'ı Sultan II. Bayezid yaptırmıştır.", ["BUR-0009-F001"]))
    return responder


@pytest.fixture(scope="module")
def real_lexicon():
    pytest.importorskip("zeyrek")
    lex = TurkishLexicon(background=False)
    assert lex.state == "ready"
    return lex


class FakeLexicon:
    def __init__(self, bad=(), state="ready"):
        self.bad, self.state = set(bad), state

    def add_words(self, texts):
        pass

    def unknown_words(self, text, allowed=""):
        return [w for w in text.replace(",", " ").replace(".", " ").split() if w in self.bad] if self.state == "ready" else []


# --- 1. Fotoğraf analizi başarısız --------------------------------------------------------------------------------

def _assert_photo_failed(r, kind):
    assert r["status"] == "photo_analysis_failed" and r["mode"] == "generative"
    assert r["message"].startswith("Fotoğraf analiz edilemedi.")
    assert r["actions"] == FAILED_ACTIONS and "explain_architecture" not in r["actions"]
    # Açık eserin kaydı, katalog araması veya eser varsayımı yok; teknik ayrıntı yok.
    assert r["search"] is None and r["facts"] == [] and r["sentences"] == [] and r["monument"] is None
    assert r["options"] == [] and r["manual_options"] == [] and r["photo"] is None
    assert r["fallback_reason"] == kind
    for leak in ("HTTP", "502", "429", "Nvidia", "timeout", "Ulu", "Bayezid"):
        assert leak not in r["message"]


@pytest.mark.parametrize("page", ["BUR-0001", None])
@pytest.mark.parametrize("kind", ["timeout", "unavailable", "rate_limited", "quota", "moderation", "bad_request"])
def test_failed_photo_analysis_never_shows_page_records(kind, page):
    budget = DailyBudget(None, 40, 1_000_000)
    svc, provider = make_service(lambda m, msgs: "{}", models=VISION_MODELS, fail=ProviderError(kind, 502), budget=budget)
    r = svc.ask("Bu yapı hakkında bilgi verir misin?", page, image_bytes=_jpeg())
    _assert_photo_failed(r, kind)
    assert len(provider.calls) == 1 and budget.status()["calls"] == 1  # tek çağrı, kotadan düşüldü, yeniden deneme yok


@pytest.mark.parametrize("setup,kind", [
    ("budget", "budget"), ("busy", "busy"), ("circuit", "circuit_open"), ("deadline", "timeout"),
])
def test_photo_analysis_blocked_before_any_call_is_reported_the_same_way(setup, kind):
    budget = DailyBudget(None, 0 if setup == "budget" else 40, 1_000_000, max_per_minute=0 if setup == "busy" else None)
    settings = GuideSettings(deadline_s=1.0, min_call_s=8.0) if setup == "deadline" else None
    svc, provider = make_service(lambda m, msgs: "{}", models=VISION_MODELS, budget=budget, settings=settings)
    if setup == "circuit":
        svc.breaker = CircuitBreaker()
        svc.breaker.failure("rate_limited", 120)
    r = svc.ask("Bu yapı ne zaman yapıldı?", "BUR-0001", image_bytes=_jpeg())
    _assert_photo_failed(r, kind)
    assert provider.calls == []


def test_real_provider_timeout_on_vision_is_reported_without_answering():
    svc, _ = make_service(lambda m, msgs: "{}", models=VISION_MODELS,
                          settings=GuideSettings(vision_timeout_s=0.4, min_call_s=0.1))
    svc.provider = _openrouter(lambda r: httpx.Response(200, json={"data": VISION_MODELS}) if r.url.path.endswith("/models")
                               else httpx.Response(200, stream=_Trickle()))
    r = svc.ask("Bu yapı hakkında bilgi verir misin?", "BUR-0001", image_bytes=_jpeg())
    _assert_photo_failed(r, "timeout")
    assert "zamanında" in r["message"] and svc.budget.status()["timeouts"] == 1


def test_failed_analysis_through_api_is_a_normal_answer(monkeypatch, tmp_path):
    monkeypatch.setenv("VAKIFNAME_GUIDE_MODE", "on")
    app = create_app(public_catalog_file=CATALOG, demo_api=False, ask_background=False)
    from app.guide.provider import MockProvider
    app.state.guide.provider = MockProvider(lambda m, msgs: "{}", models=VISION_MODELS, fail=ProviderError("unavailable", 502))
    app.state.guide.face_screen = FakeFaceScreen()
    import base64
    body = {"question": "Bu yapı ne?", "monument_id": "BUR-0001",
            "image": {"data": base64.b64encode(_jpeg()).decode(), "mime": "image/jpeg", "consent": True}}
    r = TestClient(app).post("/guide/ask", json=body)
    assert r.status_code == 200
    _assert_photo_failed(r.json(), "unavailable")


def test_answer_failure_after_a_reliable_match_searches_only_the_matched_monument():
    def responder(model, messages):
        if isinstance(messages[-1]["content"], list):
            return json.dumps(KOZA_MATCH, ensure_ascii=False)
        raise ProviderError("unavailable", 502)
    svc, _ = make_service(responder, models=VISION_MODELS)
    r = svc.ask("Bu yapı ne zaman yapıldı?", image_bytes=_jpeg())  # açık eser sayfası yok
    assert r["mode"] == "fallback_search" and r["photo"]["candidates"][0]["monument_id"] == "BUR-0009"
    assert r["search"]["monument"]["monument_id"] == "BUR-0009" and "analiz edilemedi" not in r["message"]


def test_question_without_photo_still_answers_from_catalog():
    svc, provider = make_service(lambda m, msgs: answer(("Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", ["BUR-0001-F001"])))
    r = svc.ask("Bu yapıyı kim yaptırdı?", "BUR-0001")
    assert r["status"] == "answered" and r["monument"]["monument_id"] == "BUR-0001" and r["actions"] == []


# --- 2. Gözlem filtreleri ------------------------------------------------------------------------------------------

def _checker():
    return Checker({}, ["Koza Han'ı Sultan Yıldırım Bayezid yaptırmıştır.", "Büyük Selçuklu döneminde değil.",
                        "Büyük bir avlusu vardır."], [])


@pytest.mark.parametrize("text,ok", [
    ("Yalnızca mimari özelliklerden kimlik belirlenemiyor.", True),     # "mimari" ≠ "mimar"
    ("Büyük ve net harflerle yazılmış bir levha var.", True),            # cümle başındaki "Büyük" ad değil
    ("Yapının mimarı bilinmiyor.", False),                               # mimar: tarihî bilgi
    ("Fotoğrafta büyük bir kubbe, kemerler, pencereler ve revak görülüyor.", True),
    ("Yapı 1490'da inşa edilmiş.", False),
    ("Kapıda Bayezid adı var.", False),
])
def test_observation_checker_keeps_ordinary_words(text, ok):
    assert (_checker()._check(Sentence(text, [PHOTO_ID])) is None) is ok


def test_ordinal_numbers_do_not_split_sentences():
    assert _sentences("Bu düzen 16. yüzyılda yaygınlaştı. Kubbe büyük.") == ["Bu düzen 16. yüzyılda yaygınlaştı.", "Kubbe büyük."]


def test_real_selimiye_observation_keeps_correct_architecture_and_drops_unseen_elements():
    svc, _ = make_service(_vlm(REAL_SELIMIYE), models=VISION_MODELS)
    p = svc.ask("Bu cami ne zaman ve kim tarafından yapıldı?", image_bytes=_jpeg())["photo"]
    # Görev 22'de "mimari" yüzünden silinen kimlik gerekçesi artık gösterilir.
    assert p["identity"]["reason"].startswith("Fotoğrafta yapıya özgü bir isim levhası")
    # Görünen öğelerin açıklaması kalır; görünmeyen avlu/revak anlatılmaz.
    assert "Kubbe, caminin ana odasını" in p["architecture_explanation"] and "Minareler" in p["architecture_explanation"]
    assert "Kemerler" in p["architecture_explanation"] and "Revak" not in p["architecture_explanation"]
    assert "minare" in p["description"] and "kiremit" not in p["description"]  # malzeme betimlemede kesin söylenmez
    assert p["features"] == ["kubbe", "minare", "kemer", "pencere", "kapı", "duvar", "ağaç"]


def test_real_koza_observation_drops_broken_words_and_keeps_the_rest(real_lexicon):
    svc, _ = make_service(_vlm(REAL_KOZA), models=VISION_MODELS)
    svc.lexicon = real_lexicon
    r = svc.ask("Bu yapı ne zaman ve kimin için yapıldı?", image_bytes=_jpeg())
    p = r["photo"]
    shown = json.dumps(p, ensure_ascii=False)
    assert "okşu" not in shown.lower() and "kaminler" not in shown  # bozuk sözcükler
    assert "Revak" not in p["architecture_explanation"]              # görünmeyen öğe
    assert p["identity"]["reason"].startswith("Büyük ve net harflerle")  # Görev 22'de yanlışlıkla silinmişti
    assert "Yanlarda bitkisel süslemeler ve bilgi panoları yer alıyor." in p["description"]
    assert {"altın harfli levha", "bitkisel süslemeler", "bilgi panoları"} <= set(p["features"])
    assert "Demir ızgaralı pencereler" not in p["architecture_explanation"]  # malzeme kesin söylenmez
    assert r["status"] == "answered" and r["monument"]["monument_id"] == "BUR-0009"


@pytest.mark.parametrize("word,known", [
    ("okşu", False), ("okşulu", False), ("duşarlı", False), ("kesmeköprüsü", False), ("kaminler", False),
    ("mimari", True), ("büyük", True), ("revaklı", True), ("şadırvan", True), ("mukarnaslı", True), ("merkezî", True),
    ("kubbeli", True), ("minareler", True), ("kündekâri", True), ("şerefeli", True),
])
def test_real_lexicon_flags_broken_turkish_words(real_lexicon, word, known):
    assert real_lexicon.ok(word) is known


def test_visible_text_and_unavailable_lexicon_never_drop_observations():
    obs = {**KOZA_MATCH, "description": "Kapının üstünde okşu biçimli süsleme var. Giriş kemerlidir.", "visible_text": "KOZA HAN"}
    svc, _ = make_service(_vlm(obs), models=VISION_MODELS)
    svc.lexicon = FakeLexicon(bad={"okşu"}, state="unavailable")  # sözlük yüklenemediyse hiçbir şey silinmez
    assert "okşu" in svc.ask("Bu yapı ne?", image_bytes=_jpeg())["photo"]["description"]
    svc.lexicon = FakeLexicon(bad={"okşu"})
    assert svc.ask("Bu yapı ne?", image_bytes=_jpeg())["photo"]["description"] == "Giriş kemerlidir."


@pytest.mark.parametrize("guess,shown", [
    ("Cephe kırmızı tuğla ve krem taş sıralarına benziyor.", True),
    ("Duvarlar sıvalı olabilir.", True),
    ("Cephe tuğladan yapılmıştır.", False),                    # çekincesiz kesin hüküm
    ("Kesinlikle taştan yapılmış gibi görünüyor.", False),     # "kesin"
    ("Selimiye'deki gibi taş olabilir.", False),               # yer adı
    ("", False),
])
def test_material_guess_is_hedged_and_kept_out_of_historical_answer(guess, shown):
    calls = []
    obs = {**KOZA_MATCH, "material_guess": {"text": guess, "certainty": "low"}}
    svc, _ = make_service(_vlm(obs, calls, lambda msgs: answer(("Cephe tuğladan yapılmıştır.", [PHOTO_ID]),
                                                               ("Koza Han'ı Sultan II. Bayezid yaptırmıştır.", ["BUR-0009-F001"]))),
                          models=VISION_MODELS)
    r = svc.ask("Bu yapı neden yapılmış?", image_bytes=_jpeg())
    assert r["photo"]["material_guess"] == (guess if shown else "")
    answer_prompt = calls[1][1][-1]["content"]
    assert "material_guess" not in answer_prompt and (not guess or guess not in answer_prompt)
    # Cevapta malzeme yalnızca onaylı kayıttan gelebilir; fotoğraf atfıyla malzeme cümlesi çıkarılır.
    assert [s["text"] for s in r["sentences"]] == ["Koza Han'ı Sultan II. Bayezid yaptırmıştır."]


def test_identity_claims_in_observation_need_visible_evidence():
    obs = {**KOZA_MATCH, "visible_text": "",
           "description": "Bu Koza Han'dır ve 1490'da II. Bayezid yaptırmıştır. Giriş kemerlidir.",
           "identity": {"identifiable": "yes", "reason": "Yapı Koza Han olarak bilinir."}}
    svc, _ = make_service(_vlm(obs), models=VISION_MODELS)
    p = svc.ask("Bu yapı ne?", image_bytes=_jpeg())["photo"]
    assert p["description"] == "Giriş kemerlidir." and p["identity"]["reason"] == ""


def test_vision_prompt_asks_for_hedged_material_and_visible_only_explanation():
    seen = {}

    def responder(model, messages):
        if isinstance(messages[-1]["content"], list):
            seen["system"] = messages[0]["content"]
            return json.dumps(KOZA_MATCH, ensure_ascii=False)
        return answer(("Koza Han'ı Sultan II. Bayezid yaptırmıştır.", ["BUR-0009-F001"]))
    svc, _ = make_service(responder, models=VISION_MODELS)
    svc.ask("Bu yapı ne?", image_bytes=_jpeg())
    assert '"material_guess"' in seen["system"] and "Fotoğrafta görünmeyen öğeyi" in seen["system"]
    assert "terim uydurma" in seen["system"]


def test_lexicon_status_is_reported(monkeypatch, tmp_path):
    monkeypatch.setenv("VAKIFNAME_GUIDE_MODE", "testers")
    key = tmp_path / "tester"
    key.write_text(TESTER_KEY)
    os.chmod(key, 0o600)
    monkeypatch.setenv("VAKIFNAME_GUIDE_TESTER_KEY_FILE", str(key))
    app = create_app(public_catalog_file=CATALOG, demo_api=False, ask_background=False)
    app.state.guide.lexicon = FakeLexicon()
    c = TestClient(app)
    assert c.post("/guide/session", json={"key": TESTER_KEY}, headers=GUIDE).status_code == 204
    assert c.get("/guide/status", headers=GUIDE).json()["detail"]["lexicon"] == "ready"
