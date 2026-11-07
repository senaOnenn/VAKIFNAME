"""R5.3: metin sağlayıcısından bağımsız görsel sağlayıcı (metin Evren + Gemma, görsel OpenRouter + Nemotron VL).

Ağsız: sahte sağlayıcılar ve sahte yüz denetimi. Gerçek API çağrısı, gerçek anahtar ve gerçek fotoğraf yoktur.
"""

import json
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ask.service import AskService
from app.guide.budget import DailyBudget
from app.guide.evren_provider import EvrenProvider
from app.guide.image import ImageRejected
from app.guide.provider import DEFAULT_MODEL, MockProvider, OpenRouterProvider, ProviderError
from app.guide.registry import ProviderConfigError, build_vision_provider, known_models
from app.guide.secret import KeyStatus
from app.guide.service import GuideService, GuideSettings
from app.main import create_app
from app.public_catalog import PublicCatalogRepository
from tests.test_guide import CATALOG, KOZA_MATCH, VISION_MODELS, FakeFaceScreen, _jpeg, answer

GEMMA = "gemma-4-31b"
KOZA_ANSWER = answer(("Koza Han'ı Sultan II. Bayezid yaptırmıştır.", ["BUR-0009-F001"]))


def _evren(responder=None):
    """Metin sağlayıcısı: Evren gibi yalnızca metin bildiren sahte sağlayıcı (görsel girdi bildirmez)."""
    return MockProvider(responder or (lambda m, msgs: KOZA_ANSWER),
                        models=[{"id": GEMMA, "architecture": {"input_modalities": ["text"]}, "supported_parameters": ["response_format"]}])


def _vision(obs=KOZA_MATCH, fail=None):
    return MockProvider(lambda m, msgs: json.dumps(obs, ensure_ascii=False), models=VISION_MODELS, fail=fail)


def _service(text=None, vision=None, face=None, vision_model=DEFAULT_MODEL):
    ask = AskService(PublicCatalogRepository(CATALOG), background=False)
    settings = GuideSettings(text_model=GEMMA, vision_model=vision_model)
    text = text or _evren()
    svc = GuideService(ask, text, DailyBudget(None, 100, 1_000_000), settings, face_screen=face or FakeFaceScreen(),
                       vision_provider=vision)
    return svc, text


class _NoKey(MockProvider):
    def __init__(self, status=KeyStatus.MISSING):
        super().__init__(lambda m, msgs: "{}", models=VISION_MODELS)
        self.status = status

    def available(self):
        return False, self.status


# --- Seçim ---------------------------------------------------------------------------------------------------------

def test_vision_provider_selection(monkeypatch):
    monkeypatch.delenv("VAKIFNAME_GUIDE_VISION_PROVIDER", raising=False)
    assert build_vision_provider() == (None, None)  # boş: metin sağlayıcısı (eski davranış)
    monkeypatch.setenv("VAKIFNAME_GUIDE_VISION_PROVIDER", "OpenRouter ")
    p, name = build_vision_provider()
    assert isinstance(p, OpenRouterProvider) and name == "openrouter" and p.allow_paid is False
    for bad in ("evren", "claude-cli", "nvidia", "gemini"):  # görsel girdisi doğrulanmamış ya da yazılmamış
        monkeypatch.setenv("VAKIFNAME_GUIDE_VISION_PROVIDER", bad)
        with pytest.raises(ProviderConfigError):
            build_vision_provider()


def test_known_models_never_hits_the_network():
    def handler(request):
        raise AssertionError("ağ çağrısı yapılmamalı")
    p = OpenRouterProvider("https://ornek.invalid/api/v1", key_loader=lambda: ("gizli", "ok"), transport=httpx.MockTransport(handler))
    assert known_models(p) is None  # önbellek boş: bilinmiyor
    assert known_models(EvrenProvider("https://evren.invalid", models=(GEMMA,), key_loader=lambda: ("k", "ok")))[0]["id"] == GEMMA


def test_app_builds_separate_vision_provider_with_nemotron_default(monkeypatch, tmp_path):
    monkeypatch.setenv("VAKIFNAME_GUIDE_VISION_PROVIDER", "openrouter")
    monkeypatch.delenv("VAKIFNAME_GUIDE_VISION_MODEL", raising=False)
    monkeypatch.setenv("VAKIFNAME_OPENROUTER_KEY_FILE", str(tmp_path / "yok"))
    app = create_app(public_catalog_file=CATALOG, demo_api=False, ask_background=False)
    g = app.state.guide
    assert isinstance(g.vision_provider, OpenRouterProvider) and g.settings.vision_model == DEFAULT_MODEL
    assert g.vision_breaker is not g.breaker


# --- photo: yalnızca hepsi hazırken true --------------------------------------------------------------------------

@pytest.mark.parametrize("case,expected", [
    ("ready", True),
    ("no_face_screen", False),
    ("face_models_unavailable", False),
    ("vision_key_missing", False),
    ("vision_key_insecure", False),
    ("vision_model_text_only", False),
    ("vision_list_unknown", True),  # ağsız bilinmiyor: ilk fotoğrafta doğrulanır, desteklemiyorsa "başarısız" döner
    ("no_vision_provider_text_only", False),  # bugünkü yerel durum: Evren metin-yalnız, ayrı görsel sağlayıcı yok
])
def test_photo_enabled_requires_face_screen_and_ready_vision_provider(case, expected):
    face, vision = FakeFaceScreen(), _vision()
    if case == "no_face_screen":
        face = None
    elif case == "face_models_unavailable":
        face = FakeFaceScreen(available=False)
    elif case == "vision_key_missing":
        vision = _NoKey()
    elif case == "vision_key_insecure":
        vision = _NoKey(KeyStatus.INSECURE)
    elif case == "vision_model_text_only":
        vision = MockProvider(lambda m, msgs: "{}", models=[{"id": DEFAULT_MODEL, "architecture": {"input_modalities": ["text"]}}])
    elif case == "vision_list_unknown":
        vision = OpenRouterProvider("https://ornek.invalid/api/v1", key_loader=lambda: ("gizli", "ok"),
                                    transport=httpx.MockTransport(lambda r: (_ for _ in ()).throw(AssertionError("ağ"))))
    elif case == "no_vision_provider_text_only":
        vision = None
    svc, _ = _service(vision=vision, face=face, vision_model=DEFAULT_MODEL if vision else "")
    if face is None:
        svc.face_screen = None
    assert svc.photo_enabled() is expected
    st = svc.status()["vision"]
    assert set(st) == {"provider", "separate", "key", "model", "declared", "face_screen", "circuit"}
    assert "gizli" not in json.dumps(svc.status())  # anahtar değeri durum yanıtında yok


def test_public_status_photo_and_no_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("VAKIFNAME_GUIDE_MODE", "on")
    monkeypatch.setenv("VAKIFNAME_GUIDE_VISION_PROVIDER", "openrouter")
    monkeypatch.setenv("VAKIFNAME_OPENROUTER_KEY_FILE", str(tmp_path / "yok"))
    app = create_app(public_catalog_file=CATALOG, demo_api=False, ask_background=False)
    app.state.guide.provider = _evren()
    app.state.guide.face_screen = FakeFaceScreen()
    client = TestClient(app)
    assert client.get("/guide/status").json()["photo"] is False  # görsel anahtar yok
    app.state.guide.vision_provider = _vision()
    body = client.get("/guide/status").json()
    assert body["photo"] is True and "detail" not in body and "vision" not in body
    app.state.guide.face_screen = FakeFaceScreen(available=False)
    assert client.get("/guide/status").json()["photo"] is False  # yüz denetimi yok


# --- Akış: görsel ayrı, metin Evren'de ------------------------------------------------------------------------------

def test_photo_goes_to_vision_provider_and_answer_to_text_provider_without_image():
    vision = _vision()
    svc, text = _service(vision=vision)
    r = svc.ask("Bu yapıyı kim yaptırdı?", image_bytes=_jpeg())
    assert r["status"] == "answered" and r["photo"]["candidates"][0]["monument_id"] == "BUR-0009"
    assert [c["model"] for c in vision.calls] == [DEFAULT_MODEL]
    assert [c["model"] for c in text.calls] == [GEMMA]
    # Metin sağlayıcısına (Evren) görüntü gitmez: yalnızca gözlem metni.
    for m in text.calls[0]["messages"]:
        assert not isinstance(m["content"], list)
        assert "base64" not in str(m["content"]) and "data:image" not in str(m["content"])
    # Kaynak denetimi sürer: her cümle onaylı kayda bağlı.
    assert all(s["sources"] for s in r["sentences"]) and {f["fact_id"] for f in r["facts"]} == {"BUR-0009-F001"}


def test_unsourced_or_foreign_claims_are_still_removed_with_separate_vision():
    svc, _ = _service(text=_evren(lambda m, msgs: answer(("Koza Han'ı Sultan II. Bayezid yaptırmıştır.", ["BUR-0009-F001"]),
                                                         ("Han 1850 yılında yandı.", ["BUR-9999-F001"]))), vision=_vision())
    r = svc.ask("Bu yapıyı kim yaptırdı?", image_bytes=_jpeg())
    texts = [s["text"] for s in r["sentences"]]
    assert "Han 1850 yılında yandı." not in texts and r["removed_claims"] >= 1


@pytest.mark.parametrize("kind,status", [("rate_limited", 429), ("quota", 429), ("unavailable", 503)])
def test_vision_failure_does_not_stop_text_guide(kind, status):
    vision = _vision(fail=ProviderError(kind, status, retry_after=60))
    svc, text = _service(vision=vision)
    r = svc.ask("Bu yapıyı kim yaptırdı?", image_bytes=_jpeg())
    assert r["status"] == "photo_analysis_failed" and r["photo"] is None and r["sentences"] == []  # başarılı gibi gösterilmez
    assert text.calls == []
    if kind != "unavailable":
        assert svc.vision_breaker.state()["open"] is True
    assert svc.breaker.state()["open"] is False  # metin kesicisi etkilenmez
    r2 = svc.ask("Koza Han'ı kim yaptırdı?", "BUR-0009")
    assert r2["status"] == "answered" and r2["mode"] == "generative" and len(text.calls) == 1


def test_unsupported_vision_model_is_reported_as_failed_not_answered():
    vision = MockProvider(lambda m, msgs: "{}", models=[{"id": DEFAULT_MODEL, "architecture": {"input_modalities": ["text"]}}])
    svc, text = _service(vision=vision)
    r = svc.ask("Bu yapı hangisi?", image_bytes=_jpeg())
    assert r["status"] == "photo_analysis_failed" and vision.calls == [] and text.calls == []


# --- Gizlilik -------------------------------------------------------------------------------------------------------

class _UnavailableFaceScreen:
    """Gerçek FaceScreen gibi: modeller yüklenemezse `faces` fotoğrafı reddeder."""
    available = False

    def faces(self, data):
        raise ImageRejected("Fotoğraf gizlilik denetimi şu anda kullanılamıyor; fotoğraf analizi kapalı.")


@pytest.mark.parametrize("face", ["none", "unavailable", "face_found"])
def test_photo_rejected_before_any_provider_call_without_face_clearance(face):
    vision = _vision()
    svc, text = _service(vision=vision)
    svc.face_screen = {"none": None, "unavailable": _UnavailableFaceScreen(), "face_found": FakeFaceScreen(faces=1)}[face]
    with pytest.raises(ImageRejected):
        svc.ask("Bu yapı hangisi?", image_bytes=_jpeg())
    assert vision.calls == [] and text.calls == []  # hiçbir sağlayıcıya gitmedi


def test_photo_is_not_written_to_disk_or_logs(tmp_path, monkeypatch, caplog):
    monkeypatch.chdir(tmp_path)
    caplog.set_level(logging.DEBUG)
    vision = _vision()
    svc, _ = _service(vision=vision)
    question = "GIZLI-SORU-123 bu yapıyı kim yaptırdı?"
    data = _jpeg(exif=b"Exif\x00\x00GPS-GIZLI-KONUM")
    svc.ask(question, image_bytes=data)
    assert list(tmp_path.iterdir()) == []
    logs = caplog.text
    assert "GIZLI-SORU-123" not in logs and "GPS-GIZLI-KONUM" not in logs and "base64" not in logs and "/9j/" not in logs
    # EXIF/GPS görsel sağlayıcıya da gitmez.
    sent = json.dumps(vision.calls[0]["messages"])
    assert "GPS-GIZLI-KONUM" not in sent and "R1BTLUdJWkxJLUtPTlVN" not in sent


def test_without_separate_provider_behaviour_is_unchanged():
    """Görsel sağlayıcı verilmezse görsel ve metin aynı sağlayıcı ve kesiciyi kullanır (eski davranış)."""
    one = MockProvider(lambda m, msgs: json.dumps(KOZA_MATCH, ensure_ascii=False) if isinstance(msgs[-1]["content"], list)
                       else KOZA_ANSWER, models=VISION_MODELS)
    ask = AskService(PublicCatalogRepository(CATALOG), background=False)
    svc = GuideService(ask, one, DailyBudget(None, 100, 1_000_000), GuideSettings(), face_screen=FakeFaceScreen())
    assert svc.vision_breaker is None and svc.photo_enabled() is True
    r = svc.ask("Bu yapıyı kim yaptırdı?", image_bytes=_jpeg())
    assert r["status"] == "answered" and len(one.calls) == 2


def test_status_detail_never_contains_key_value():
    secret = "sk-or-ornek-anahtar-degeri-1234567890"
    p = OpenRouterProvider("https://ornek.invalid/api/v1", key_loader=lambda: (secret, "ok"),
                           transport=httpx.MockTransport(lambda r: (_ for _ in ()).throw(AssertionError("ağ"))))
    svc, _ = _service(vision=p)
    assert secret not in json.dumps(svc.status()) and svc.status()["vision"]["key"] == "ok"
