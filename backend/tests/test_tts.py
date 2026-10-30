"""Seslendirme (Faz 8): yalnızca onaylı anlatım cümlesi seslendirilir, her cümle bir kez üretilip önbelleğe alınır,
kapalıyken arayüz tarayıcı sesine düşer; anlatım kalıpları arayüzle birebir aynıdır."""

import re
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.tts import INTRO, INTRO_EN, OUTRO, OUTRO_EN, PREFIX, PREFIX_EN, GoogleTts, SpeechService, TtsError, TtsSettings, pick_voice

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
NARRATION_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "app" / "narration.ts"


class FakeTts:
    name = "fake"

    def __init__(self, fail: str = ""):
        self.calls, self.fail = [], fail

    def synthesize(self, text, voice, language, rate):
        if self.fail:
            raise TtsError(self.fail)
        self.calls.append((text, voice, language, rate))
        return b"ID3" + text.encode("utf-8")

    def voices(self, language):
        return ["tr-TR-Standard-A", "tr-TR-Chirp3-HD-Leda", "tr-TR-Chirp3-HD-Aoede"]


@pytest.fixture(autouse=True)
def env(monkeypatch):
    for n in ("VAKIFNAME_TTS_PROVIDER", "VAKIFNAME_TTS_CACHE_DIR", "VAKIFNAME_TTS_GOOGLE_KEY_FILE", "VAKIFNAME_CONTENT_DIR"):
        monkeypatch.delenv(n, raising=False)


def client(tmp_path, fake=None):
    app = create_app(public_catalog_file=SNAPSHOT, demo_api=False)
    if fake is not None:
        app.state.speech = SpeechService(TtsSettings(provider="google", cache_dir=tmp_path / "tts"), fake)
    return TestClient(app)


def test_off_by_default_browser_voice(tmp_path):
    with client(tmp_path) as c:
        assert c.get("/speech/status").json() == {"enabled": False, "provider": "browser", "voice": None}
        assert c.post("/monuments/BUR-0001/speech", json={"text": "x"}).status_code == 503


def test_only_approved_narration_is_spoken_and_cached(tmp_path):
    fake = FakeTts()
    with client(tmp_path, fake) as c:
        m = c.get("/monuments/BUR-0001").json()
        intro = INTRO.format(name=m["name"])
        r = c.post("/monuments/BUR-0001/speech", json={"text": intro})
        assert r.status_code == 200 and re.fullmatch(r"/speech/audio/[0-9a-f]{64}\.mp3", r.json()["url"])
        assert fake.calls == [(intro, "tr-TR-Chirp3-HD-Aoede", "tr-TR", 1.0)]  # Chirp 3 HD önce, kararlı sıra
        again = c.post("/monuments/BUR-0001/speech", json={"text": intro})
        assert again.json() == r.json() and len(fake.calls) == 1  # önbellekten
        audio = c.get(r.json()["url"])
        assert audio.status_code == 200 and audio.headers["content-type"] == "audio/mpeg" and audio.content.startswith(b"ID3")
        osman = c.get("/monuments/BUR-0019").json()
        fact = next(f for f in osman["facts"] if f["certainty"] == "reported")
        assert c.post("/monuments/BUR-0019/speech", json={"text": PREFIX["reported"] + fact["text"]}).status_code == 200
        assert c.post("/monuments/BUR-0001/speech", json={"text": OUTRO}).status_code == 200
        # Onaylı anlatımda olmayan metin seslendirilmez (ücret yazdırma ve uydurma söz engeli).
        assert c.post("/monuments/BUR-0001/speech", json={"text": "Bunu ben uydurdum."}).status_code == 422
        assert c.post("/monuments/BUR-0019/speech", json={"text": fact["text"]}).status_code == 422  # ön eksiz rivayet
        assert c.post("/monuments/BUR-9999/speech", json={"text": intro}).status_code == 404
        assert c.get("/speech/audio/" + "0" * 64 + ".mp3").status_code == 404
        assert c.get("/speech/status").json()["enabled"] is True


def test_provider_failure_is_honest_503(tmp_path):
    with client(tmp_path, FakeTts(fail="quota")) as c:
        name = c.get("/monuments/BUR-0001").json()["name"]
        r = c.post("/monuments/BUR-0001/speech", json={"text": INTRO.format(name=name)})
        assert r.status_code == 503 and "quota" in r.json()["detail"]


def test_new_synthesis_is_rate_limited_but_cache_is_not(tmp_path):
    fake = FakeTts()
    with client(tmp_path, fake) as c:
        from app.ask_routes import RateLimiter
        c.app.state.speech_limiter = RateLimiter(per_minute=1, per_hour=10, global_per_minute=10)
        m = c.get("/monuments/BUR-0001").json()
        intro = INTRO.format(name=m["name"])
        assert c.post("/monuments/BUR-0001/speech", json={"text": intro}).status_code == 200
        assert c.post("/monuments/BUR-0001/speech", json={"text": OUTRO}).status_code == 429
        assert c.post("/monuments/BUR-0001/speech", json={"text": intro}).status_code == 200


def test_templates_match_frontend_narration():
    ts = NARRATION_TS.read_text(encoding="utf-8")
    assert INTRO.replace("{name}", "${m.name}") in ts and OUTRO in ts
    for cert, prefix in PREFIX.items():
        assert f"{cert}: '{prefix}'" in ts
    assert INTRO_EN.replace("{name}", "${name}") in ts and OUTRO_EN in ts
    for cert, prefix in PREFIX_EN.items():
        assert f"{cert}: '{prefix}'" in ts


def test_google_request_shape_and_errors():
    seen = {}

    def handler(req: httpx.Request):
        seen["key"] = req.headers.get("x-goog-api-key")
        if req.url.path.endswith("/voices"):
            return httpx.Response(200, json={"voices": [{"name": "tr-TR-Chirp3-HD-Leda"}]})
        seen["body"] = req.read()
        return httpx.Response(200, json={"audioContent": "SUQz"})

    g = GoogleTts("anahtar", transport=httpx.MockTransport(handler))
    assert g.synthesize("Merhaba", "tr-TR-Chirp3-HD-Leda", "tr-TR", 1.0) == b"ID3"
    assert seen["key"] == "anahtar" and b'"audioEncoding":"MP3"' in seen["body"].replace(b" ", b"")
    assert g.voices("tr-TR") == ["tr-TR-Chirp3-HD-Leda"]
    for status, kind in ((403, "auth"), (429, "quota"), (500, "http_500")):
        bad = GoogleTts("x", transport=httpx.MockTransport(lambda r, s=status: httpx.Response(s)))
        with pytest.raises(TtsError) as e:
            bad.synthesize("a", "v", "tr-TR", 1.0)
        assert e.value.kind == kind
    assert pick_voice(["b", "a"]) == "a" and pick_voice([]) is None


def test_invalid_provider_env_fails_at_startup(monkeypatch):
    monkeypatch.setenv("VAKIFNAME_TTS_PROVIDER", "elevenlabs")
    with pytest.raises(ValueError):
        TtsSettings.from_env()


def test_english_narration_uses_english_voice_and_approved_english_only(tmp_path):
    fake = FakeTts()
    fake.voices = lambda language: [f"{language}-Chirp3-HD-Kore", f"{language}-Standard-A"]
    with client(tmp_path, fake) as c:
        m = c.app.state.monuments.get("BUR-0001")
        f = m.facts[0].model_copy(update={"title_en": "Built", "text_en": "Sultan Bayezid commissioned it.",
                                          "en_decision_id": "DEC-" + "a" * 16})
        c.app.state.monuments._state[1]["BUR-0001"] = m.model_copy(update={"facts": (f,) + m.facts[1:], "name_en": "Grand Mosque"})
        intro = INTRO_EN.format(name="Grand Mosque")
        assert c.post("/monuments/BUR-0001/speech", json={"text": intro, "lang": "en"}).status_code == 200
        assert fake.calls[-1][1:3] == ("en-US-Chirp3-HD-Kore", "en-US")
        assert c.post("/monuments/BUR-0001/speech", json={"text": "Sultan Bayezid commissioned it.", "lang": "en"}).status_code == 200
        # Türkçe metin İngilizce olarak, İngilizce metin Türkçe olarak seslendirilmez.
        assert c.post("/monuments/BUR-0001/speech", json={"text": intro, "lang": "tr"}).status_code == 422
        assert c.post("/monuments/BUR-0001/speech", json={"text": OUTRO, "lang": "en"}).status_code == 422


def test_files_provider_plays_only_pregenerated_audio_and_never_synthesizes(tmp_path):
    """30 Ekim kararı: ses klonuyla önceden üretilmiş dosyalar; sunucu üretmez, eksik cümle 404 → tarayıcı sesi."""
    from app.public_catalog import PublicCatalogRepository
    from app.tts_export import jobs

    settings = TtsSettings(provider="files", voice="talha-1", voice_en="talha-1", cache_dir=tmp_path / "tts")
    service = SpeechService(settings)
    assert service.enabled and not service.generates and service.voice("tr") == "talha-1"
    assert service.status() == {"enabled": True, "provider": "files", "voice": "talha-1"}
    app = create_app(public_catalog_file=SNAPSHOT, demo_api=False)
    app.state.speech = service
    catalog = PublicCatalogRepository(SNAPSHOT).catalog
    work = jobs(catalog, service, ["tr", "en"])
    assert work and all(j["lang"] == "tr" for j in work)  # anlık görüntüde onaylı İngilizce kayıt yok → İngilizce iş yok
    assert len({j["file"] for j in work}) == len(work)
    m = catalog.monuments[0]
    intro = next(j for j in work if j["monument_id"] == m.monument_id and j["text"] == INTRO.format(name=m.name))
    with TestClient(app) as c:
        missing = c.post(f"/monuments/{m.monument_id}/speech", json={"text": intro["text"]})
        assert missing.status_code == 404  # önceden üretilmemiş: üretim yok
        (tmp_path / "tts" / intro["file"]).write_bytes(b"ID3 klon")  # üretim betiğinin yazdığı dosya
        r = c.post(f"/monuments/{m.monument_id}/speech", json={"text": intro["text"]})
        assert r.status_code == 200 and r.json()["url"] == f"/speech/audio/{intro['file']}"
        assert c.get(r.json()["url"]).content == b"ID3 klon"
        assert c.post(f"/monuments/{m.monument_id}/speech", json={"text": "Uydurma cümle."}).status_code == 422
        # Üretim olmadığı için sınır yok: çok sayıda istek 429 almaz.
        for _ in range(40):
            assert c.post(f"/monuments/{m.monument_id}/speech", json={"text": OUTRO}).status_code == 404
    assert next(j for j in jobs(catalog, service, ["tr"]) if j["file"] == intro["file"])["ready"] is True


def test_files_provider_env(monkeypatch, tmp_path):
    monkeypatch.setenv("VAKIFNAME_TTS_PROVIDER", "files")
    monkeypatch.setenv("VAKIFNAME_TTS_VOICE", "ayse-1")
    s = TtsSettings.from_env()
    assert s.provider == "files" and s.voice == "ayse-1" and s.voice_en == "auto"
    s.cache_dir = tmp_path
    assert SpeechService(s).voice("en") == "default"
