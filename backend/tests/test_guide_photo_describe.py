"""R5.7: fotoğraf betimleme ve kaynaklı eser tanıma (sahte sağlayıcılarla, ağsız; gerçek fotoğraf yok).

Görsel gözlem ("Fotoğrafta görülenler") tarihî kaynak değildir ve eşleşme olmasa da (denetimden geçtiyse) döner. Tarihî
bilgi (kimlik, yaptıran, tarih, konum) yalnızca güvenilir eşleşmeden sonra onaylı kayıtlardan, Checker'dan geçerek gelir.
"""

import json

import pytest

from app.guide.image import ImageRejected
from app.guide.provider import DEFAULT_MODEL, MockProvider, ProviderError
from app.guide.service import NOT_MATCHED
from tests.test_guide import F001, VISION_MODELS, FakeFaceScreen, _jpeg, answer
from tests.test_guide_vision_provider import GEMMA, _evren, _service

# Kurgusal gözlemler (modelin JSON çıktısı biçiminde). Kent fotoğrafı katalogla eşleşmez.
CITY = {
    "is_architecture": True, "building_type": "diğer",
    "description": "Fotoğrafta kırmızı çatılı, sık dizilmiş evlerden oluşan bir kent görülüyor. Arka planda karla "
                   "kaplı bir dağ, ön planda yeşil ağaçlar var. Görüntü yüksek bir noktadan geniş açıyla çekilmiş gibi "
                   "görünüyor. Bu kent 1326 yılında fethedildi.",
    "features": ["kırmızı çatılar", "karlı dağ", "ağaçlar"],
    "architecture_explanation": "", "visible_text": "",
    "identity": {"identifiable": "no", "reason": "Ayırt edici bir yapı veya yazı görünmüyor."},
    "synthetic_signs": [], "catalog_match": [],
}
ULU = {
    "is_architecture": True, "building_type": "cami",
    "description": "Fotoğrafta çok sayıda küçük kubbeyle örtülü, açık renkli cepheli geniş bir yapı görülüyor. Yanında yüksek bir "
                   "minare var ve gökyüzü açık mavi.",
    "features": ["çok sayıda kubbe", "minare", "açık renkli cephe"],
    "architecture_explanation": "Kubbe, altındaki mekânı örten yarım küre biçimli örtüdür.", "visible_text": "",
    "identity": {"identifiable": "uncertain", "reason": "Çok kubbeli plan ayırt edici görünüyor."},
    "synthetic_signs": [],
    "catalog_match": [{"monument_id": "BUR-0001", "likelihood": "high", "reason": "çok kubbeli plan"}],
}
ULU_ANSWER = answer(("Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001]))


def _vision(obs):
    return MockProvider(lambda m, msgs: json.dumps(obs, ensure_ascii=False) if isinstance(obs, dict) else obs,
                        models=VISION_MODELS)


def _text(answer_text=ULU_ANSWER):
    return _evren(lambda m, msgs: answer_text)


def test_unmatched_city_photo_is_described_without_history():
    vision, text = _vision(CITY), _text()
    svc, _ = _service(text=text, vision=vision)
    r = svc.ask("Burada ne görüyorsun?", image_bytes=_jpeg())
    assert r["status"] == "photo_not_matched" and r["message"] == NOT_MATCHED
    p = r["photo"]
    assert p["observed"] is True
    assert "kırmızı çatılı" in p["description"] and "karla kaplı bir dağ" in p["description"]
    assert "1326" not in p["description"] and "fethedildi" not in p["description"]  # tarihî iddia gözlemden atılır
    # Kimlik, kaynak, tarihî cümle yok; metin modeline hiç gidilmez.
    assert r["sentences"] == [] and r["facts"] == [] and r["monument"] is None and p["candidates"] == []
    assert text.calls == [] and len(vision.calls) == 1


def test_material_words_in_observation_stay_filtered_unless_hedged():
    """Mevcut güvenlik kuralı korunur: betimlemede kesin malzeme iddiası gösterilmez (yalnızca çekinceli izlenim)."""
    obs = {**CITY, "description": "Fotoğrafta kiremit çatılı evler görülüyor. Arka planda karla kaplı bir dağ var."}
    svc, _ = _service(text=_text(), vision=_vision(obs))
    p = svc.ask("Burada ne görüyorsun?", image_bytes=_jpeg())["photo"]
    assert "kiremit" not in p["description"] and "karla kaplı bir dağ" in p["description"]


def test_question_text_reaches_the_vision_model_as_context():
    vision = _vision(CITY)
    svc, _ = _service(text=_text(), vision=vision)
    svc.ask("Arka plandaki dağı anlatır mısın?", image_bytes=_jpeg())
    sent = json.dumps(vision.calls[0]["messages"], ensure_ascii=False)
    assert "Arka plandaki dağı anlatır mısın?" in sent and "çevre (gökyüzü" in sent


@pytest.mark.parametrize("question", ["Bu yapı nedir?", "Kim yaptırdı?"])
def test_matched_ulu_cami_gets_sourced_history_and_separate_observation(question):
    vision, text = _vision(ULU), _text()
    svc, _ = _service(text=text, vision=vision)
    r = svc.ask(question, image_bytes=_jpeg())
    assert r["status"] == "answered" and r["monument"]["monument_id"] == "BUR-0001"
    assert [s["sources"] for s in r["sentences"]] == [[F001]] and {f["fact_id"] for f in r["facts"]} == {F001}
    assert r["photo"]["observed"] is True and r["photo"]["candidates"][0]["monument_id"] == "BUR-0001"
    # Metin modeline görüntü gitmez; gözlem metni bağlam olarak gider.
    assert all(not isinstance(m["content"], list) for m in text.calls[0]["messages"])


def test_unmatched_photo_who_built_it_never_invents_history():
    text = _text(answer(("Bu yapıyı Sultan Orhan yaptırmıştır.", [F001])))  # çağrılırsa uydurma olurdu
    svc, _ = _service(text=text, vision=_vision(CITY))
    r = svc.ask("Kim yaptırdı?", image_bytes=_jpeg())
    assert r["status"] == "photo_not_matched" and r["sentences"] == [] and r["facts"] == []
    assert text.calls == []
    assert "yaptıranı" in r["message"]
    assert "Orhan" not in json.dumps({k: r[k] for k in ("message", "sentences", "facts", "photo")}, ensure_ascii=False)


def test_unmatched_photo_on_monument_page_does_not_borrow_that_page_history():
    text = _text()
    svc, _ = _service(text=text, vision=_vision(CITY))
    r = svc.ask("Kim yaptırdı?", "BUR-0001", image_bytes=_jpeg())  # açık eser sayfası fotoğrafa kimlik atamaz
    assert r["status"] == "photo_not_matched" and r["facts"] == [] and text.calls == []


@pytest.mark.parametrize("vision", [
    MockProvider(lambda m, msgs: "{}", models=VISION_MODELS, fail=ProviderError("unavailable", 503)),
    MockProvider(lambda m, msgs: "{}", models=VISION_MODELS, fail=ProviderError("rate_limited", 429)),
])
def test_vision_error_gives_no_fake_description(vision):
    text = _text()
    svc, _ = _service(text=text, vision=vision)
    r = svc.ask("Burada ne görüyorsun?", image_bytes=_jpeg())
    assert r["status"] == "photo_analysis_failed" and r["photo"] is None and r["sentences"] == [] and text.calls == []


@pytest.mark.parametrize("raw", ["", "bozuk yanıt", json.dumps({"description": "", "features": [], "catalog_match": []}),
                                 json.dumps({"description": "Bu yapı 1400 yılında Sultan Yıldırım Bayezid tarafından yaptırıldı.",
                                             "features": [], "catalog_match": []}, ensure_ascii=False)])
def test_empty_or_fully_filtered_observation_is_not_presented_as_a_description(raw):
    svc, _ = _service(text=_text(), vision=_vision(raw))
    r = svc.ask("Burada ne görüyorsun?", image_bytes=_jpeg())
    assert r["photo"]["observed"] is False and r["photo"]["description"] == "" and r["sentences"] == []


def test_face_photo_is_rejected_before_any_external_call():
    vision, text = _vision(CITY), _text()
    svc, _ = _service(text=text, vision=vision, face=FakeFaceScreen(faces=1))
    with pytest.raises(ImageRejected):
        svc.ask("Burada ne görüyorsun?", image_bytes=_jpeg())
    assert vision.calls == [] and text.calls == []


def test_text_only_question_is_unchanged_and_has_no_photo_field():
    vision, text = _vision(CITY), _text()
    svc, _ = _service(text=text, vision=vision)
    r = svc.ask("Ulu Cami'yi kim yaptırdı?", "BUR-0001")
    assert r["status"] == "answered" and r["photo"] is None and vision.calls == []
    assert [c["model"] for c in text.calls] == [GEMMA] and [s["sources"] for s in r["sentences"]] == [[F001]]
    assert DEFAULT_MODEL not in [c["model"] for c in text.calls]
