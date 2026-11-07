"""Gemma (Evren) ile rehberin uçtan uca akışı: `POST /guide/ask` → GuideService → onaylı katalog araması → EvrenProvider
→ iddia denetimi. Uygulama gerçek yapılandırma yoluyla kurulur (registry: `VAKIFNAME_GUIDE_PROVIDER=evren`,
`VAKIFNAME_GUIDE_MODEL=gemma-4-31b`). Sahte testlerde yalnızca ağ (`httpx.MockTransport`) ve anahtar okuyucu değiştirilir.
Gerçek API testi en altta ve yalnızca `VAKIFNAME_EVREN_LIVE_TEST=1` ile çalışır."""

import copy
import json
import os
import re
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.guide.evren_provider import EvrenProvider
from app.main import create_app
from app.public_catalog import PublicCatalogRepository
from tests.test_guide_evren import RecordingTransport, response_shape

CATALOG = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
GEMMA, SERVED = "gemma-4-31b", "google/gemma-4-31b"
QUESTION = "Bursa Ulu Cami'yi kim yaptırmıştır?"
F001 = "BUR-0001-F001"  # "Yıldırım Bayezid'in camisi" (documented, kitap s. 20)
KEY = "evren-test-anahtari-0123456789"  # sahte
FACT_ID = re.compile(r"\b[A-Z]{3}-\d{4}-F\d{3}\b")


def _catalog() -> dict:
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def _approved() -> dict[str, dict]:
    """Yayın kararı ve editör kararı olan kayıtlar (genel katalog yalnızca bunları içerebilir)."""
    return {f["fact_id"]: f for m in _catalog()["monuments"] for f in m["facts"]
            if f.get("editorial_decision_id") and f.get("publication_decision_id")}


def _env(monkeypatch):
    for k, v in {"VAKIFNAME_GUIDE_PROVIDER": "evren", "VAKIFNAME_GUIDE_MODEL": GEMMA, "VAKIFNAME_GUIDE_FALLBACK": "none",
                 "VAKIFNAME_GUIDE_MODE": "on", "VAKIFNAME_GUIDE_BUDGET_DB": ":memory:"}.items():
        monkeypatch.setenv(k, v)
    # Türkçe sözlük (~200 MB) yalnızca açıkça istenirse yüklenir; kaynak denetimi sözlükten bağımsızdır.
    monkeypatch.setenv("VAKIFNAME_GUIDE_LEXICON", os.environ.get("VAKIFNAME_GUIDE_LEXICON", "off"))
    monkeypatch.delenv("VAKIFNAME_CONTENT_MODEL", raising=False)


def _client(monkeypatch, handler, seen=None) -> tuple[TestClient, EvrenProvider]:
    _env(monkeypatch)
    monkeypatch.delenv("VAKIFNAME_EVREN_BASE_URL", raising=False)
    app = create_app(public_catalog_file=CATALOG, demo_api=False, ask_background=False)
    provider = app.state.guide.provider
    assert isinstance(provider, EvrenProvider) and app.state.guide.settings.text_model == GEMMA

    def record(request):
        if seen is not None:
            seen.append(request)
        return handler(request)
    provider._transport = httpx.MockTransport(record)  # yalnızca ağ katmanı sahte
    provider._key_loader = lambda: (KEY, "ok")
    return TestClient(app), provider


def _reply(text: str, stop="end_turn", out=120):
    return lambda request: httpx.Response(200, json={
        "id": "msg_1", "type": "message", "role": "assistant", "model": SERVED,
        "content": [{"type": "text", "text": text}], "stop_reason": stop,
        "usage": {"input_tokens": 1800, "output_tokens": out}})


def _answer(*sentences, status="answered", missing=""):
    return json.dumps({"status": status, "sentences": [{"text": t, "sources": s} for t, s in sentences],
                       "missing": missing}, ensure_ascii=False)


def _ask(c: TestClient, question=QUESTION, monument_id=None):
    r = c.post("/guide/ask", json={"question": question, "monument_id": monument_id})
    assert r.status_code == 200, r.status_code
    return r.json()


# --- Sahte API ile uçtan uca -----------------------------------------------------------------------------------------

def test_ulu_cami_builder_is_answered_only_from_approved_records(monkeypatch):
    seen = []
    reply = _answer(("Bursa Ulu Camii'ni Sultan Yıldırım Bayezid yaptırmıştır.", [F001]),
                    ("Mimarı Ali Neccar'dır.", [F001]),                        # kayıtta yok
                    ("Yapı 1399–1400'de tamamlanmıştır.", ["BUR-9999-F001"]))    # verilmemiş / onaysız kimlik
    c, _ = _client(monkeypatch, _reply(reply), seen)
    r = _ask(c)
    approved = _approved()

    # İstek: Evren /v1/messages, Gemma, sistem istemi ayrı, cevap sınırı servis ayarı (1000 token).
    req = seen[0]
    assert (req.url.host, req.url.path) == ("evren-llmapi.ssyz.org.tr", "/v1/messages")
    body = json.loads(req.content)
    assert body["model"] == GEMMA and body["max_tokens"] == 1000 and body["system"]
    sent_ids = set(FACT_ID.findall(json.dumps(body, ensure_ascii=False)))
    assert F001 in sent_ids and sent_ids <= set(approved)  # modele yalnızca onaylı kayıtlar gider

    # Cevap: desteklenen cümle kalır, desteksiz ve yabancı kimlikli cümleler çıkar; kaynak ve karar kimliği korunur.
    assert r["mode"] == "generative" and r["status"] == "answered"
    assert [s["text"] for s in r["sentences"]] == ["Bursa Ulu Camii'ni Sultan Yıldırım Bayezid yaptırmıştır."]
    assert r["sentences"][0]["sources"] == [F001] and r["removed_claims"] == 2
    [fact] = r["facts"]
    assert fact["fact_id"] == F001 and fact["monument_id"] == "BUR-0001"
    assert fact["publication_decision_id"] == approved[F001]["publication_decision_id"]
    assert fact["sources"] and all(s["url"].startswith("https://") for s in fact["sources"])
    assert r["models"] == [SERVED] and r["usage"]["calls"] == 1


def test_missing_information_is_not_guessed(monkeypatch):
    c, _ = _client(monkeypatch, _reply(_answer(status="insufficient_evidence", missing="Kapı sayısı kayıtlarda yok.")))
    r = _ask(c, "Bursa Ulu Cami'nin kaç kapısı var?", "BUR-0001")
    assert r["status"] == "insufficient_evidence" and r["sentences"] == [] and r["facts"] == []
    # Model yine de bir sayı uydurursa cümle kaynakla desteklenmediği için düşer.
    c, _ = _client(monkeypatch, _reply(_answer(("Ulu Cami'nin yedi kapısı vardır.", [F001]))))
    r = _ask(c, "Bursa Ulu Cami'nin kaç kapısı var?", "BUR-0001")
    assert r["status"] == "insufficient_evidence" and r["sentences"] == [] and r["removed_claims"] == 1


def test_truncated_answer_at_token_limit_falls_back_to_source_search(monkeypatch):
    partial = '{"status": "answered", "sentences": [{"text": "Bursa Ulu Camii\'ni Sultan'
    c, _ = _client(monkeypatch, _reply(partial, stop="max_tokens", out=1000))
    r = _ask(c)
    assert r["mode"] == "fallback_search" and r["fallback_reason"] == "parse_error"
    assert r.get("sentences", []) == []  # yarım cevap gösterilmez
    assert r["search"]["status"] == "answered" and r["search"]["answer"]["fact_id"] in _approved()


def test_gemma_unavailable_falls_back_to_approved_source_search(monkeypatch):
    c, _ = _client(monkeypatch, lambda request: httpx.Response(
        503, json={"type": "error", "error": {"type": "api_error", "message": "x"}}))
    r = _ask(c)
    assert r["mode"] == "fallback_search" and r["fallback_reason"] == "unavailable"
    assert r["search"]["answer"]["fact_id"] in _approved()


@pytest.mark.parametrize("mutate", [
    lambda f: f.pop("editorial_decision_id"),           # editör onayı yok
    lambda f: f.pop("publication_decision_id"),         # yayın kararı yok
    lambda f: f.update(status="quarantine"),            # karantina işaretli aday
])
def test_unapproved_or_quarantined_record_cannot_enter_the_public_catalog(tmp_path, mutate):
    data = copy.deepcopy(_catalog())
    mutate(next(m for m in data["monuments"] if m["monument_id"] == "BUR-0001")["facts"][0])
    bad = tmp_path / "catalog.json"
    bad.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ValueError):  # şema reddeder: rehbere hiç ulaşamaz
        PublicCatalogRepository(bad)


# --- Gerçek API (yalnızca açıkça istenirse) --------------------------------------------------------------------------

@pytest.mark.skipif(os.environ.get("VAKIFNAME_EVREN_LIVE_TEST") != "1",
                    reason="Gerçek Evren uçtan uca testi: VAKIFNAME_EVREN_LIVE_TEST=1 ve anahtar dosyası gerekir.")
def test_live_gemma_answers_ulu_cami_question_from_approved_records(monkeypatch):
    _env(monkeypatch)
    app = create_app(public_catalog_file=CATALOG, demo_api=False, ask_background=False)
    provider, settings = app.state.guide.provider, app.state.guide.settings
    assert isinstance(provider, EvrenProvider) and settings.text_model == GEMMA
    ok, status = provider.available()
    assert ok, f"Evren anahtarı kullanılamıyor: {status}"
    rec = RecordingTransport(httpx.HTTPTransport())
    provider._transport = rec
    r = _ask(TestClient(app))
    shape = response_shape(rec.raw) if rec.status is not None else {}
    approved = _approved()
    sources = [i for s in r.get("sentences", []) for i in s["sources"]]
    # Yalnızca meta veri: kimlikler, durumlar, sayılar. Anahtar, istem ve model metni yazılmaz.
    print(f"\nEvren uçtan uca: endpoint={provider.base_url}/v1/messages model={settings.text_model} "
          f"dönen={r.get('models')} mode={r.get('mode')} status={r.get('status')} "
          f"fallback={r.get('fallback_reason')} cümle={len(r.get('sentences', []))} kaynaklar={sources} "
          f"kayıtlar={[(f['fact_id'], f['publication_decision_id']) for f in r.get('facts', [])]} "
          f"çıkarılan={r.get('removed_claims')} usage={r.get('usage')} stop={shape.get('stop_reason')} "
          f"max_tokens={settings.max_answer_tokens}")
    assert r["mode"] == "generative", f"kaynaklı aramaya düştü: {r.get('fallback_reason')}"
    assert r["status"] == "answered" and r["sentences"]
    assert shape.get("stop_reason") == "end_turn"  # cevap token sınırında kesilmedi
    assert r["usage"]["completion_tokens"] < settings.max_answer_tokens
    assert SERVED in r["models"]
    for s in r["sentences"]:
        assert s["sources"] and all(i in approved and i.startswith("BUR-0001-") for i in s["sources"])
    for f in r["facts"]:
        assert f["publication_decision_id"] == approved[f["fact_id"]]["publication_decision_id"] and f["sources"]
