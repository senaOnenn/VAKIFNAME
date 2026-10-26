"""Görev 32: fotoğrafın mimari analizi öncelikli; kimlik isteğe bağlı; takip soruları (sahte sağlayıcıyla, ağsız).

Model çıktıları elle yazılmış, gerçekçi Nemotron yanıtlarıdır. Her birine bilerek uydurma unsurlar (tarih, bani, üslup,
görünmeyen öğe, çekincesiz malzeme) konmuştur: bunların ziyaretçiye hiç ulaşmadığı sınanır.
"""

import base64
import json

import pytest
from fastapi.testclient import TestClient

from app.guide.claims import GENERAL_ID, PHOTO_ID
from app.guide.provider import MockProvider, ProviderError
from app.guide.service import NOT_VERIFIED, PHOTO_FAILED
from app.main import create_app
from tests.test_guide import CATALOG, F001, VISION_MODELS, FakeFaceScreen, _jpeg, answer, make_service

CATALOG_IDS = ["BUR-0001", "BUR-0003", "BUR-0005", "BUR-0007", "BUR-0008", "BUR-0009", "BUR-0013", "BUR-0014",
               "BUR-0019", "BUR-0020"]


def obs(description, features, matches=(), building_type="cami", **kw):
    return {"is_architecture": True, "building_type": building_type, "description": description, "features": features,
            "material_guess": {"text": "", "certainty": "low"}, "visible_text": "",
            "identity": {"identifiable": "uncertain", "reason": "Ayırt edici bir yazı görünmüyor."},
            "synthetic_signs": [], "catalog_match": list(matches), **kw}


# A. Gece çekilmiş Ulu Cami dış görünüşü (kullanıcının bildirdiği durum: gözlem doğru, kimlik yok).
NIGHT_ULU = obs(
    "Fotoğraf gece çekilmiş; yapı sıcak sarı ışıklarla aydınlatılmış ve koyu gökyüzünün önünde belirgin biçimde öne "
    "çıkıyor. Dikdörtgen gövdenin üzerinde sıra sıra dizilmiş çok sayıda küçük kubbe görülüyor; bu düzen, iç mekânın "
    "birçok bölmeye ayrıldığını düşündürüyor. Yapının iki yanında birer yüksek minare yükseliyor ve şerefeleri ayrıca "
    "ışıklandırılmış. Bu yapı 1399'da Yıldırım Bayezid tarafından yaptırılmıştır. Erken Osmanlı üslubunun güzel bir "
    "örneğidir. Ön planda sokak lambaları ve çevredeki alçak yapılar, caminin yoğun bir kent dokusunun içinde yer "
    "aldığını gösteriyor. Fotoğraf hafifçe aşağıdan çekildiği için minareler olduğundan daha da yüksek görünüyor.",
    ["çok sayıda küçük kubbe", "iki yüksek minare", "gece aydınlatması", "kent dokusu"])
# B. Tabelasız Ulu Cami iç mekânı.
INTERIOR_ULU = obs(
    "Fotoğraf geniş bir iç mekânı gösteriyor. Mekân, kalın ve köşeli taşıyıcılarla bölmelere ayrılmış; bunlar sütun "
    "değil paye gibi görünüyor. Payeler kesme taşa benziyor. Payeler taştan yapılmıştır. Payeleri birbirine bağlayan "
    "sivri kemerlerin üzerinde kubbeler yükseliyor. Duvarlarda ve payelerde büyük hat levhaları asılı, kemer "
    "kenarlarında geometrik bezemeler seçiliyor. Ortadaki mihrap mermer işçiliğiyle dikkat çekiyor.",
    ["payeler", "sivri kemerler", "kubbeler", "hat levhaları", "geometrik bezeme"])
# C. Muradiye Camii dış cephesi.
MURADIYE = obs(
    "Fotoğrafta tek minareli, kubbeli bir cami cephesi görülüyor. Duvarlar yatay sıralar halinde dizilmiş tuğla ve taşa "
    "benziyor. Önde kemerli bir giriş bölümü var. Minare ince ve yüksek bir gövdeye sahip.",
    ["tek minare", "kubbe", "almaşık görünümlü duvar dokusu", "kemerli giriş"],
    matches=[{"monument_id": "BUR-0003", "likelihood": "high", "reason": "tek minare ve almaşık duvar"}])
# D. Katalog dışı bir Bursa camisi; model aynı türden diye Ulu Cami'yi "orta" benzerlikle yazıyor.
OTHER_MOSQUE = obs(
    "Fotoğrafta tek kubbeli, küçük bir mahalle camisi görülüyor. Kubbenin önünde üç bölümlü bir son cemaat yeri var ve "
    "yanında tek şerefeli bir minare yükseliyor. Bursa Ulu Camii'ne benziyor.",
    ["tek kubbe", "son cemaat yeri", "tek şerefeli minare"],
    matches=[{"monument_id": "BUR-0001", "likelihood": "medium", "reason": "kubbeli cami"}])
# E. Yalnızca bir mimari ayrıntı; model binanın tamamını uydurmaya çalışıyor.
DETAIL_ONLY = obs(
    "Fotoğraf yalnızca bir kapı çevresini yakından gösteriyor. Kapıyı çevreleyen silmelerin içinde yıldız biçimli "
    "geometrik bezemeler görülüyor. Yapının iki minaresi ve büyük bir kubbesi vardır. Yapının tamamı görünmediği için "
    "genel düzeni hakkında bir şey söylenemez.",
    ["kapı çevresi", "geometrik bezeme", "silmeler"], building_type="belirsiz")


def responder(observation, calls=None, answer_text=None):
    def r(model, messages):
        kind = "vision" if isinstance(messages[-1]["content"], list) else "text"
        if calls is not None:
            calls.append((kind, messages))
        if kind == "vision":
            return json.dumps(observation, ensure_ascii=False)
        return answer_text or answer(("Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001]))
    return r


def shown(r) -> str:
    return json.dumps({k: r[k] for k in ("message", "sentences", "photo", "options")}, ensure_ascii=False)


# --- 1-3. Analiz öncelikli; kimlik isteğe bağlı ----------------------------------------------------------------------

@pytest.mark.parametrize("page", [None, "BUR-0001"])
def test_a_night_photo_shows_architecture_even_without_identity(page):
    calls = []
    svc, _ = make_service(responder(NIGHT_ULU, calls), models=VISION_MODELS)
    r = svc.ask("Bu fotoğraftaki yapı hakkında ne söyleyebilirsin?", page, image_bytes=_jpeg())
    assert r["status"] == "photo_analyzed" and r["message"] == NOT_VERIFIED
    assert [c[0] for c in calls] == ["vision"]  # tek çağrı; eşleşme yoksa tarihî cevap çağrısı yapılmaz
    d = r["photo"]["description"]
    # Şerefe minarenin parçasıdır: ayrıca etiketlenmemiş olsa da cümle düşmez (canlı benzeri denemede düşüyordu).
    for seen in ("gece çekilmiş", "küçük kubbe", "şerefeleri ayrıca ışıklandırılmış", "kent dokusunun", "aşağıdan çekildiği"):
        assert seen in d
    # Uydurulan tarih, bani ve üslup gösterilmez; açık sayfanın eseri fotoğrafa atanmaz.
    assert "1399" not in shown(r) and "Bayezid" not in shown(r) and "Osmanlı" not in shown(r)
    assert r["monument"] is None and r["facts"] == [] and r["sentences"] == []
    assert 60 <= len(d.split()) <= 140
    assert r["actions"] == ["explain_more", "choose_manually", "upload_another"]


def test_b_interior_keeps_hedged_material_and_drops_unhedged_material_and_unseen_mihrab():
    svc, _ = make_service(responder(INTERIOR_ULU), models=VISION_MODELS)
    r = svc.ask("Bu iç mekân hakkında ne söyleyebilirsin?", image_bytes=_jpeg())
    d = r["photo"]["description"]
    assert "sütun değil paye gibi görünüyor" in d and "kesme taşa benziyor" in d
    assert "taştan yapılmıştır" not in d       # çekincesiz malzeme hükmü
    assert "mihrap" not in d                   # özelliklerde olmayan (görülmemiş) öğe
    assert {"payeler", "kubbeler", "hat levhaları"} <= set(r["photo"]["features"])
    assert r["status"] == "photo_analyzed"


def test_c_reliable_match_with_historical_question_answers_from_records():
    calls = []
    svc, _ = make_service(responder(MURADIYE, calls, answer(("Kayıtlara göre caminin onaylı bir kaydı var.",
                                                                   ["BUR-0003-F001"]))), models=VISION_MODELS)
    r = svc.ask("Burası neresi?", image_bytes=_jpeg())
    assert [c[0] for c in calls] == ["vision", "text"]
    assert r["photo"]["candidates"][0]["monument_id"] == "BUR-0003"
    assert "tuğla ve taşa benziyor" in r["photo"]["description"]


def test_c_architecture_question_with_match_does_not_spend_a_history_call():
    calls = []
    svc, _ = make_service(responder(MURADIYE, calls), models=VISION_MODELS)
    r = svc.ask("Bu yapıda hangi mimari özellikler dikkat çekiyor?", image_bytes=_jpeg())
    assert [c[0] for c in calls] == ["vision"] and r["status"] == "photo_analyzed"
    assert r["monument"]["monument_id"] == "BUR-0003" and r["facts"] == []


@pytest.mark.parametrize("page", [None, "BUR-0001"])
def test_d_non_catalog_mosque_is_analyzed_but_never_matched(page):
    svc, _ = make_service(responder(OTHER_MOSQUE), models=VISION_MODELS)
    r = svc.ask("Bu cami hakkında bilgi verir misin?", page, image_bytes=_jpeg())
    assert r["status"] == "photo_analyzed" and r["photo"]["candidates"] == [] and r["monument"] is None
    assert "son cemaat yeri" in r["photo"]["description"] and "Ulu" not in shown(r)
    assert [o["monument_id"] for o in r["manual_options"]] == CATALOG_IDS  # tarafsız sıra, öneri değil


def test_e_single_detail_does_not_invent_the_whole_building():
    svc, _ = make_service(responder(DETAIL_ONLY), models=VISION_MODELS)
    d = svc.ask("Bu ne?", image_bytes=_jpeg())["photo"]["description"]
    assert "geometrik bezemeler" in d and "tamamı görünmediği" in d
    assert "minare" not in d and "kubbe" not in d


# --- 8. Hatalar ------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("err", [ProviderError("unavailable", 502), ProviderError("unavailable", 503),
                                 ProviderError("timeout")])
@pytest.mark.parametrize("page", [None, "BUR-0001"])
def test_f_provider_errors_show_a_clear_message_and_no_analysis_or_match(err, page):
    svc, provider = make_service(responder(NIGHT_ULU), models=VISION_MODELS, fail=err)
    r = svc.ask("Bu yapı ne?", page, image_bytes=_jpeg())
    assert r["status"] == "photo_analysis_failed"
    assert r["message"] == f"{PHOTO_FAILED} Yeniden deneyebilirsiniz."
    assert r["photo"] is None and r["monument"] is None and r["options"] == [] and r["facts"] == []
    assert r["search"] is None and len(provider.calls) == 1  # görsel çağrı yeniden denenmez


@pytest.mark.parametrize("raw", ["Üzgünüm, bu görseli inceleyemiyorum.", "{}",
                                 json.dumps({"is_architecture": True, "description": "1399'da yaptırılmıştır.",
                                             "features": []})])
def test_f_unreadable_or_empty_analysis_is_a_failure_not_a_fake_result(raw):
    svc, _ = make_service(lambda m, msgs: raw, models=VISION_MODELS)
    r = svc.ask("Bu yapı ne?", "BUR-0001", image_bytes=_jpeg())
    assert r["status"] == "photo_analysis_failed" and r["fallback_reason"] == "parse_error" and r["photo"] is None


# --- 6. Takip soruları ----------------------------------------------------------------------------------------------

CONTEXT = {"description": "Yapının üzerinde sıra sıra dizilmiş çok sayıda küçük kubbe görülüyor. Yapının iki yanında "
                          "birer yüksek minare yükseliyor.", "features": ["çok sayıda küçük kubbe", "iki yüksek minare"]}


def followup_reply(*sentences, status="answered"):
    return json.dumps({"status": status, "sentences": [{"text": t, "basis": b} for t, b in sentences]}, ensure_ascii=False)


def test_followup_uses_previous_analysis_not_the_image_and_labels_each_sentence():
    calls = []
    reply = followup_reply(
        ("Fotoğrafta yapının üstünde sıra sıra dizilmiş çok sayıda küçük kubbe görülüyor.", "photo"),
        ("Kubbe, altındaki mekânı örten yarım küre biçimli örtüdür.", "general"),
        ("Çok kubbeli düzen, geniş bir mekânı küçük bölmelere ayırarak örtmeyi sağlar.", "general"),
        ("Kubbelerin altındaki mihrap da fotoğrafta çok süslü görünüyor.", "photo"),       # analizde yok
        ("Bu düzen 14. yüzyılda yaygınlaşmıştır.", "general"),                             # tarihî iddia
        ("Bu yapının mihrabı mermerden yapılmıştır.", "general"))                         # "genel" etiketli uydurma
    svc, provider = make_service(lambda m, msgs: calls.append(msgs) or reply, models=VISION_MODELS)
    r = svc.ask("Kubbeleri daha ayrıntılı açıklar mısın?", "BUR-0001", photo_context=CONTEXT)
    assert r["status"] == "photo_followup" and len(provider.calls) == 1
    msgs = calls[0]
    assert isinstance(msgs[-1]["content"], str)  # görsel gönderilmez
    assert "ŞU ANDA FOTOĞRAFI GÖRMÜYORSUN" in msgs[0]["content"] and CONTEXT["description"] in msgs[-1]["content"]
    assert [(s["text"][:22], s["sources"]) for s in r["sentences"]] == [
        ("Fotoğrafta yapının üst", [PHOTO_ID]), ("Kubbe, altındaki mekân", [GENERAL_ID]),
        ("Çok kubbeli düzen, gen", [GENERAL_ID])]
    assert r["removed_claims"] == 3 and r["facts"] == [] and r["monument"] is None


def test_followup_that_needs_unseen_detail_asks_for_the_photo_again():
    svc, _ = make_service(lambda m, msgs: followup_reply(status="needs_photo"), models=VISION_MODELS)
    r = svc.ask("Kapının üstündeki yazıda ne yazıyor?", photo_context=CONTEXT)
    assert r["status"] == "photo_context_needed" and "yeniden yükler" in r["message"] and r["sentences"] == []
    assert r["actions"] == ["upload_another"]


@pytest.mark.parametrize("question", ["Burası neresi?", "Bu hangi cami?"])
def test_identity_question_after_photo_needs_the_photo_and_costs_nothing(question):
    svc, provider = make_service(lambda m, msgs: pytest.fail("çağrılmamalı"), models=VISION_MODELS)
    r = svc.ask(question, "BUR-0001", photo_context=CONTEXT)
    assert r["status"] == "photo_context_needed" and provider.calls == [] and r["monument"] is None


def test_historical_question_about_unverified_photo_is_not_answered_from_the_open_page():
    svc, provider = make_service(lambda m, msgs: pytest.fail("çağrılmamalı"), models=VISION_MODELS)
    r = svc.ask("Bu cami ne zaman yapıldı?", "BUR-0001", photo_context=CONTEXT)
    assert r["status"] == "identity_required" and provider.calls == []
    assert [o["monument_id"] for o in r["manual_options"]] == CATALOG_IDS and "anlamına gelmez" in r["message"]


@pytest.mark.parametrize("ctx,question", [({**CONTEXT, "monument_id": "BUR-0001"}, "Bu cami ne zaman yapıldı?"),
                                          (CONTEXT, "Ulu Cami ne zaman yapıldı?")])
def test_historical_question_is_answered_for_a_verified_or_named_monument(ctx, question):
    svc, provider = make_service(lambda m, msgs: answer(("Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001])))
    r = svc.ask(question, None, photo_context=ctx)
    assert r["status"] == "answered" and r["monument"]["monument_id"] == "BUR-0001" and len(provider.calls) == 1


def test_followup_provider_error_is_reported_without_search_fallback():
    svc, _ = make_service(lambda m, msgs: "", models=VISION_MODELS, fail=ProviderError("unavailable", 503))
    r = svc.ask("Minarelerin mimari işlevi nedir?", photo_context=CONTEXT)
    assert r["status"] == "unavailable" and r["message"].startswith("Mimari açıklama şu anda hazırlanamadı.")
    assert r["search"] is None and r["sentences"] == []


def test_photo_context_is_accepted_and_bounded_by_the_api(monkeypatch):
    monkeypatch.setenv("VAKIFNAME_GUIDE_MODE", "on")
    app = create_app(public_catalog_file=CATALOG, demo_api=False, ask_background=False)
    app.state.guide.provider = MockProvider(lambda m, msgs: followup_reply(
        ("Minare, ezanın okunduğu yüksek kuledir.", "general")), models=VISION_MODELS)
    app.state.guide.face_screen = FakeFaceScreen()
    c = TestClient(app)
    body = {"question": "Minarelerin mimari işlevi nedir?", "monument_id": "BUR-0001", "photo_context": CONTEXT}
    r = c.post("/guide/ask", json=body)
    assert r.status_code == 200 and r.json()["status"] == "photo_followup"
    assert r.json()["sentences"][0]["sources"] == [GENERAL_ID]
    too_long = {**body, "photo_context": {**CONTEXT, "description": "a" * 1300}}
    assert c.post("/guide/ask", json=too_long).status_code == 422
    with_image = {**body, "image": {"data": base64.b64encode(_jpeg()).decode(), "mime": "image/jpeg", "consent": True}}
    app.state.guide.provider = MockProvider(responder(NIGHT_ULU), models=VISION_MODELS)
    assert c.post("/guide/ask", json=with_image).json()["status"] == "photo_analyzed"  # yeni fotoğraf bağlamdan önce gelir
