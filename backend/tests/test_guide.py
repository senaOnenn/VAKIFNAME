"""Yapay zekâ rehberi: sahte sağlayıcıyla (ağsız) güvenlik, kaynak denetimi, fotoğraf işleme, bütçe ve yedek davranış."""

import json
import logging
import os
import struct
import zlib
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ask.service import AskService
from app.guide import image as img
from app.guide.budget import CircuitBreaker, DailyBudget
from app.guide.claims import PHOTO_ID, Checker, parse
from app.guide.privacy import DEFAULT_MODEL_DIR, FaceScreen
from app.guide.provider import DEFAULT_MODEL, MockProvider, OpenRouterProvider, ProviderError
from app.guide.secret import KeyStatus, load_key
from app.guide.service import NOT_MATCHED as NOT_MATCHED_MESSAGE, GuideService, GuideSettings
from app.main import create_app
from app.public_catalog import PublicCatalogRepository

CATALOG = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
F001 = "BUR-0001-F001"  # Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır … Hicrî 802 … 1399–1400'de tamamlanmıştır.
MEDIA = Path(__file__).resolve().parents[2] / "data" / "public_catalog" / "media"
# OpenRouter `/models` biçimi.
VISION_MODELS = [{"id": DEFAULT_MODEL, "architecture": {"input_modalities": ["text", "image", "video"]},
                  "supported_parameters": ["max_tokens", "response_format", "structured_outputs", "temperature"]}]
TEXT_ONLY_MODELS = [{"id": DEFAULT_MODEL, "architecture": {"input_modalities": ["text"]}, "supported_parameters": []}]


class FakeFaceScreen:
    """Yerel yüz algılayıcının yerine: her fotoğraf için sabit yüz sayısı döner."""

    def __init__(self, faces=0, available=True):
        self.n, self.available, self.seen = faces, available, 0

    def faces(self, data):
        self.seen += 1
        return self.n


def answer(*sentences, status="answered", missing=""):
    return json.dumps({"status": status, "sentences": [{"text": t, "sources": s} for t, s in sentences], "missing": missing},
                      ensure_ascii=False)


def make_service(responder, models=None, fail=None, budget=None, settings=None, face_screen=None):
    ask = AskService(PublicCatalogRepository(CATALOG), background=False)
    provider = MockProvider(responder, models=models, fail=fail)
    return GuideService(ask, provider, budget or DailyBudget(None, 100, 1_000_000), settings or GuideSettings(),
                        face_screen=face_screen or FakeFaceScreen()), provider


# --- Anahtar ------------------------------------------------------------------------------------------------------

def _readable_by_others(f, on: bool):
    """POSIX: izin bitleri. Windows: izin bitleri erişimi göstermez; Everyone (SID S-1-1-0) okuma girdisi eklenir/kaldırılır."""
    if os.name == "nt":
        import subprocess
        args = ["/grant", "*S-1-1-0:(R)"] if on else ["/remove:g", "*S-1-1-0"]
        subprocess.run(["icacls", str(f), *args], check=True, capture_output=True)
    else:
        os.chmod(f, 0o644 if on else 0o600)


def test_key_is_read_only_from_private_file(tmp_path):
    f = tmp_path / "k"
    assert load_key(f) == (None, KeyStatus.MISSING)
    f.write_text("gizli-anahtar-123\n")
    _readable_by_others(f, True)
    assert load_key(f) == (None, KeyStatus.INSECURE)
    _readable_by_others(f, False)
    assert load_key(f) == ("gizli-anahtar-123", KeyStatus.OK)
    f.write_text("iki parça\n")
    assert load_key(f)[1] == KeyStatus.INVALID


def test_key_file_must_be_owned_by_root_or_service_account(tmp_path):
    f = tmp_path / "k"
    f.write_text("gizli-anahtar-123\n")
    os.chmod(f, 0o600)
    assert load_key(f)[1] == KeyStatus.OK
    if hasattr(os, "geteuid") and os.geteuid() == 0:  # Windows'ta geteuid yoktur
        os.chown(f, 65534, 65534)  # nobody
        assert load_key(f) == (None, KeyStatus.INSECURE)


def _openrouter(handler, **kw):
    return OpenRouterProvider("https://ornek.invalid/api/v1", key_loader=lambda: ("gizli-anahtar-123", "ok"),
                              transport=httpx.MockTransport(handler), **kw)


def _completion(model, content="{}", cost=0.0):
    return {"id": "gen-1", "model": model, "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3, "cost": cost}}


def test_provider_maps_openrouter_errors_and_never_exposes_key():
    seen = {"posts": 0}

    def handler(request: httpx.Request):
        seen["auth"], seen["title"] = request.headers.get("authorization"), request.headers.get("x-title")
        if request.url.path.endswith("/models"):
            return httpx.Response(401, json={"error": {"code": 401, "message": "gizli-anahtar-123 geçersiz"}})
        body = json.loads(request.content)
        seen["posts"] += 1
        seen["payload"] = body
        q = body["messages"][0]["content"] if body["messages"] else ""
        if q == "dakika":
            return httpx.Response(429, headers={"Retry-After": "17"},
                                  json={"error": {"code": 429, "message": "Rate limit exceeded: free-models-per-min."}})
        if q == "gun":
            return httpx.Response(429, json={"error": {"code": 429, "message": "Rate limit exceeded: free-models-per-day."}})
        if q == "kredi":
            return httpx.Response(402, json={"error": {"code": 402, "message": "Insufficient credits"}})
        if q == "denetim":
            return httpx.Response(403, json={"error": {"code": 403, "message": "Input was flagged by moderation",
                                                       "metadata": {"reasons": ["x"]}}})
        if q == "akista":
            return httpx.Response(200, json={"error": {"code": 502, "message": "upstream"}})
        if q == "ucret":
            return httpx.Response(200, json=_completion(body["model"], cost=0.0004))
        if q == "baska":
            return httpx.Response(200, json=_completion("openai/gpt-5"))
        if q == "hata":
            return httpx.Response(502, json={})
        return httpx.Response(200, json=_completion(body["model"]))

    p = _openrouter(handler)
    with pytest.raises(ProviderError) as e:
        p.models()
    assert e.value.kind == "auth" and "gizli" not in str(e.value)
    assert seen["auth"] == "Bearer gizli-anahtar-123" and seen["title"] == "VAKIFNAME"
    msg = lambda q: [{"role": "user", "content": q}]
    err = pytest.raises(ProviderError, p.chat, DEFAULT_MODEL, msg("dakika"), 10).value
    assert (err.kind, err.retry_after) == ("rate_limited", 17)
    assert pytest.raises(ProviderError, p.chat, DEFAULT_MODEL, msg("gun"), 10).value.kind == "quota"
    assert pytest.raises(ProviderError, p.chat, DEFAULT_MODEL, msg("kredi"), 10).value.kind == "quota"
    assert pytest.raises(ProviderError, p.chat, DEFAULT_MODEL, msg("denetim"), 10).value.kind == "moderation"
    assert pytest.raises(ProviderError, p.chat, DEFAULT_MODEL, msg("akista"), 10).value.kind == "unavailable"
    assert pytest.raises(ProviderError, p.chat, DEFAULT_MODEL, msg("ucret"), 10).value.kind == "paid_usage_detected"
    assert pytest.raises(ProviderError, p.chat, DEFAULT_MODEL, msg("baska"), 10).value.kind == "model_mismatch"
    assert pytest.raises(ProviderError, p.chat, DEFAULT_MODEL, msg("hata"), 10).value.kind == "unavailable"
    assert seen["posts"] == 8  # her hata tek istek: otomatik yeniden deneme yok
    r = p.chat(DEFAULT_MODEL, msg("x"), 10, json_mode=True)
    assert (r.text, r.prompt_tokens, r.completion_tokens, r.cost) == ("{}", 11, 3, 0.0)
    assert seen["payload"]["response_format"] == {"type": "json_object"} and "models" not in seen["payload"]
    assert seen["payload"]["reasoning"] == {"enabled": False}
    no_key = OpenRouterProvider("https://ornek.invalid/v1", key_loader=lambda: (None, KeyStatus.MISSING))
    assert pytest.raises(ProviderError, no_key.chat, DEFAULT_MODEL, [], 1).value.kind == "no_key"


class _Trickle(httpx.SyncByteStream):
    """Bağlantıyı boşluk karakterleriyle canlı tutan, cevabı geciktiren sağlayıcı."""

    def __init__(self, chunks=200, pause=0.05):
        self.chunks, self.pause = chunks, pause

    def __iter__(self):
        import time
        for _ in range(self.chunks):
            time.sleep(self.pause)
            yield b" "
        yield json.dumps(_completion(DEFAULT_MODEL)).encode()


def test_provider_deadline_covers_whole_response_even_with_keepalive_bytes():
    import time
    p = _openrouter(lambda r: httpx.Response(200, stream=_Trickle()))
    t0 = time.monotonic()
    err = pytest.raises(ProviderError, p.chat, DEFAULT_MODEL, [{"role": "user", "content": "x"}], 10, timeout_s=0.4).value
    assert err.kind == "timeout" and time.monotonic() - t0 < 1.5  # tek okuma zaman aşımı (0,4 sn) hiç dolmazdı
    fast = _openrouter(lambda r: httpx.Response(200, stream=_Trickle(chunks=2, pause=0.01)))
    assert fast.chat(DEFAULT_MODEL, [], 10, timeout_s=2).text == "{}"


def test_provider_errors_are_logged_with_status_and_code_but_never_message(caplog):
    def handler(request):
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": VISION_MODELS})
        return httpx.Response(200, json={"error": {"code": 502, "message": "gizli-anahtar-123 Provider returned error",
                                                   "metadata": {"provider_name": "Nvidia", "raw": "istem metni"}}})
    ask = AskService(PublicCatalogRepository(CATALOG), background=False)
    svc = GuideService(ask, _openrouter(handler), DailyBudget(None, 10, 1_000_000), face_screen=FakeFaceScreen())
    with caplog.at_level(logging.INFO):
        r = svc.ask("Ulu Cami'yi kim yaptırdı?")
    assert r["fallback_reason"] == "unavailable"
    # Ziyaretçiye giden yanıtta hata kodu, HTTP durumu veya alt sağlayıcı adı yok; yalnızca genel açıklama.
    assert "Nvidia" not in json.dumps(r, ensure_ascii=False) and "502" not in r["message"]
    assert "kind=unavailable http=502 code=502 upstream=Nvidia" in caplog.text
    assert "guide call stage=answer result=error kind=unavailable http=502 code=502 upstream=Nvidia" in caplog.text
    assert "gizli" not in caplog.text and "istem metni" not in caplog.text and "Provider returned" not in caplog.text


def test_successful_and_transport_failed_calls_are_logged_by_stage_without_content(caplog):
    def ok(request):
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": VISION_MODELS})
        return httpx.Response(200, json={**_completion(DEFAULT_MODEL), "provider": "Nvidia"})
    ask = AskService(PublicCatalogRepository(CATALOG), background=False)
    svc = GuideService(ask, _openrouter(ok), DailyBudget(None, 10, 1_000_000), face_screen=FakeFaceScreen())
    with caplog.at_level(logging.INFO):
        svc.ask("Ulu Cami'yi gizli-soru-42 kim yaptırdı?")
    assert "guide call stage=answer result=ok http=200 upstream=Nvidia" in caplog.text and "gizli-soru-42" not in caplog.text

    def broken(request):
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": VISION_MODELS})
        raise httpx.RemoteProtocolError("peer closed", request=request)
    svc.provider = _openrouter(broken)
    caplog.clear()
    with caplog.at_level(logging.INFO):
        assert svc.ask("Ulu Cami'yi kim yaptırdı?")["fallback_reason"] == "unavailable"
    assert "code=transport:RemoteProtocolError" in caplog.text


def test_provider_read_timeout_is_reported_as_timeout():
    def handler(request):
        raise httpx.ReadTimeout("yavaş", request=request)
    assert pytest.raises(ProviderError, _openrouter(handler).chat, DEFAULT_MODEL, [], 10).value.kind == "timeout"


def test_paid_model_is_blocked_before_any_request():
    calls = []
    p = _openrouter(lambda r: calls.append(r) or httpx.Response(200, json=_completion("nvidia/nemotron-3.5-super-vl")))
    assert pytest.raises(ProviderError, p.chat, "nvidia/nemotron-3.5-super-vl", [], 10).value.kind == "paid_model_blocked"
    assert calls == []
    paid_ok = _openrouter(lambda r: httpx.Response(200, json=_completion("nvidia/nemotron-3.5-super-vl", cost=0.001)),
                          allow_paid=True)
    assert paid_ok.chat("nvidia/nemotron-3.5-super-vl", [], 10).cost == 0.001


# --- Kaynak denetimi ------------------------------------------------------------------------------------------------

def _checker():
    support = {F001: "Bursa Ulu Camii. Yıldırım Bayezid'in camisi. Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır. "
                     "Minber kapısının üstündeki kitabeye göre yapı Hicrî 802 yılında, yani 1399–1400'de tamamlanmıştır.",
               "BUR-0001-KIMLIK": "Adları: Bursa Ulu Camii, Ulu Cami. Türü: cami. Konum: Osmangazi, Bursa.",
               "BUR-0001-F002": "Ulu Cami'yi kimin tasarladığı kesin olarak bilinmiyor. Araştırmacılar en çok Ali Neccâr ile "
                                "Hacı İvaz Paşa'nın adlarını anıyor; ancak bu adlar bir kitabe ya da belgeyle kanıtlanmış değil."}
    corpus = [support[F001], "Muradiye Camii'ni II. Murad yaptırmıştır.", "Koza Han'ı II. Bayezid yaptırmıştır.",
              "Rivayete göre Mimar Sinan'ın çırağı buraya gelmiştir."]
    return Checker(support, corpus, ["Bursa Ulu Camii", "Ulu Cami"])


@pytest.mark.parametrize("text,sources,ok", [
    ("Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır ve yapı 1399–1400'de tamamlanmıştır.", [F001], True),
    ("Kitabeye göre yapı Hicrî 802 yılında tamamlanmıştır.", [F001], True),
    ("Ulu Cami 1396'da tamamlanmıştır.", [F001], False),                         # kayıtta olmayan yıl
    ("Ulu Cami'yi II. Murad yaptırmıştır.", [F001], False),                     # başka kaydın kişisi
    ("Ulu Cami'yi Mimar Sinan yaptırmıştır.", [F001], False),                   # katalog dışı özel ad
    ("Ulu Cami'nin yirmi kubbesi vardır.", [F001], False),                      # kayıtta olmayan sayı sözcüğü
    ("Ulu Cami'yi Yıldırım Bayezid yaptırmıştır.", ["BUR-0009-F001"], False),   # verilmeyen kimlik
    ("Ulu Cami'yi Yıldırım Bayezid yaptırmıştır.", [], False),                  # kaynaksız
    ("Fotoğrafta iki minare ve çok kubbeli bir çatı görülüyor.", [PHOTO_ID], True),
    ("Fotoğraftaki yapı 1399'da inşa edilmiş.", [PHOTO_ID], False),             # fotoğraftan tarih
    ("Fotoğraftaki caminin banisi Yıldırım Bayezid'dir.", [PHOTO_ID], False),   # fotoğraftan kişi
    ("Bursa Ulu Camii Osmangazi'dedir.", ["BUR-0001-KIMLIK"], True),
    # Kayıtta ekli geçen ad ("Paşa'nın") cümlede de ekli geçebilir (canlı testte bulunan yanlış alarm).
    ("Araştırmacılar Ali Neccâr ile Hacı İvaz Paşa'nın adlarını anıyor.", ["BUR-0001-F002"], True),
    ("Araştırmacılar Mimar Sinan'ın adını anıyor.", ["BUR-0001-F002"], False),
    # Geçerli kimlik yetmez: malzeme ve mimari bölüm de atıf yapılan kayıtta geçmeli (karışıklık testleri).
    ("Ulu Cami'yi Sultan Yıldırım Bayezid ahşaptan yaptırmıştır.", [F001], False),          # kayıtta olmayan malzeme
    ("Ulu Cami tuğla ve taştan yapılmıştır.", [F001, "BUR-0001-F002"], False),               # kayıtta olmayan malzeme
    ("Ulu Cami'nin minaresini Sultan Yıldırım Bayezid yaptırmıştır.", [F001], False),      # kayıtta olmayan bölüm
    ("Kitabe minber kapısının üstündedir.", [F001], True),                                  # kayıttaki bölümler
    ("Ulu Cami'yi Hacı İvaz Paşa yaptırmıştır.", [F001], False),                           # başka kaydın kişisi
    ("Ulu Cami Hicrî 802 yılında, yani 1490'da tamamlanmıştır.", [F001], False),           # başka yapının tarihi
    ("Fotoğrafta tuğla ve tahta malzemeden yapılmış bir cephe görülüyor.", [PHOTO_ID], False),  # fotoğraftan malzeme
    ("Fotoğrafta kemerli bir giriş ve iki minare görülüyor.", [PHOTO_ID], True),            # görünen bölümler serbest
    ("Fotoğraftaki yapı tuğladan, kayda göre Yıldırım Bayezid yaptırmıştır.", [PHOTO_ID, F001], False),  # foto malzemeye kanıt değil
])
def test_sentence_checks(text, sources, ok):
    checked = _checker().check({"status": "answered", "sentences": [{"text": text, "sources": sources}]})
    assert (checked.status == "answered") is ok, checked.removed


@pytest.mark.parametrize("fact_id", ["BUR-0009-F001", "BUR-0001-F099", "BUR-0001-RED-F001", "BUR-0001-KIMLIK-X"])
def test_ids_not_given_to_the_model_are_never_accepted(fact_id):
    """Reddedilmiş, onaysız veya bu istekte verilmeyen kayıt kimliği metni doğru olsa bile kabul edilmez."""
    checked = _checker().check({"status": "answered", "sentences": [
        {"text": "Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", "sources": [fact_id]}]})
    assert checked.status == "insufficient_evidence" and checked.removed[0]["reason"] == "verilmeyen kayıt kimliği"


def test_model_sees_only_approved_public_facts():
    """Rehberin kanıt havuzu yalnızca yayın kararı olan genel katalogdur; editör kararı veya yayın kararı eksik kayıt yok."""
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    facts = [f for m in data["monuments"] for f in m["facts"]]
    assert len(data["monuments"]) == 10 and len(facts) == 76
    assert all(f["publication_decision_id"] and f["editorial_decision_id"] and f["sources"] for f in facts)
    ask = AskService(PublicCatalogRepository(CATALOG), background=False)
    assert {d.fact_id for d in ask.engine().corpus.docs} == {f["fact_id"] for f in facts}


def test_parse_tolerates_code_fences_and_rejects_garbage():
    assert parse('```json\n{"status": "answered", "sentences": []}\n```') == {"status": "answered", "sentences": []}
    assert parse("cevap veremem") is None


# --- Servis ---------------------------------------------------------------------------------------------------------

def test_generative_answer_keeps_supported_and_removes_unsupported_claims():
    def responder(model, messages):
        user = messages[-1]["content"]
        assert f"[{F001}]" in user and "<<<Ulu Cami'yi kim yaptırdı ve ne zaman bitti?>>>" in user
        return answer(("Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001]),
                      ("Yapı 1399–1400'de tamamlanmıştır.", [F001]),
                      ("Mimarı Ali Neccar'dır.", [F001]))  # desteksiz: çıkarılmalı
    svc, provider = make_service(responder)
    r = svc.ask("Ulu Cami'yi kim yaptırdı ve ne zaman bitti?")
    assert r["mode"] == "generative" and r["status"] == "answered"
    assert [s["text"] for s in r["sentences"]] == ["Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.",
                                                   "Yapı 1399–1400'de tamamlanmıştır."]
    assert r["removed_claims"] == 1 and [f["fact_id"] for f in r["facts"]] == [F001]
    assert r["facts"][0]["sources"][0]["url"].startswith("https://")
    assert r["monument"]["monument_id"] == "BUR-0001" and r["usage"]["calls"] == 1
    assert provider.calls[0]["model"] == DEFAULT_MODEL == "nvidia/nemotron-3.5-super-vl:free"


def test_follow_up_uses_history_only_as_context():
    def responder(model, messages):
        user = messages[-1]["content"]
        assert "ÖNCEKİ KONUŞMA (kanıt değildir)" in user and "Ziyaretçi: Ulu Cami'yi kim yaptırdı?" in user
        return answer(("Kitabeye göre yapı Hicrî 802 yılında tamamlanmıştır.", [F001]))
    svc, _ = make_service(responder)
    r = svc.ask("Peki ne zaman tamamlandı?", "BUR-0001",
                history=[{"question": "Ulu Cami'yi kim yaptırdı?", "answer": "Yıldırım Bayezid yaptırmıştır."}])
    assert r["status"] == "answered" and r["sentences"][0]["sources"] == [F001]


def test_insufficient_evidence_is_reported_without_guessing():
    svc, _ = make_service(lambda m, msgs: answer(status="insufficient_evidence", missing="Kayıtlarda kapı sayısı geçmiyor."))
    r = svc.ask("Ulu Cami'nin kaç kapısı var?", "BUR-0001")
    assert r["status"] == "insufficient_evidence" and r["sentences"] == [] and "tahmin etmiyorum" in r["message"]


@pytest.mark.parametrize("question,model_sentences,kept", [
    # Yanlış kişi önkabulü: düzeltme kalır, önkabuldeki ad tekrar edilirse o cümle çıkarılır.
    ("Ulu Cami'yi Mimar Sinan 1550'de mi yaptı?",
     [("Kayıtlara göre Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001]),
      ("Mimar Sinan ve 1550 tarihi kayıtlarda geçmiyor.", [F001])],
     ["Kayıtlara göre Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır."]),
    # Yanlış tarih önkabulü: kayıttaki tarih söylenir, sorudaki tarih doğrulanmaz.
    ("Ulu Cami 1500 yılında mı tamamlandı?",
     [("Hayır; kitabeye göre yapı 1399–1400'de tamamlanmıştır.", [F001]),
      ("Evet, 1500 yılında tamamlanmıştır.", [F001])],
     ["Hayır; kitabeye göre yapı 1399–1400'de tamamlanmıştır."]),
    # Yapı karışıklığı: başka yapının banisi bu yapıya atfedilemez.
    ("Ulu Cami'yi II. Bayezid mi yaptırdı?",
     [("Kayıtlara göre Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001]),
      ("Ulu Cami'yi II. Bayezid yaptırmıştır.", [F001])],
     ["Kayıtlara göre Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır."]),
])
def test_false_premise_is_corrected_not_confirmed(question, model_sentences, kept):
    def responder(model, messages):
        assert "Önkabulü asla doğrulama" in messages[0]["content"]
        return answer(*model_sentences, missing="Sorudaki iddia onaylı kayıtlarda geçmiyor.")
    svc, _ = make_service(responder)
    r = svc.ask(question, "BUR-0001")
    assert r["status"] == "answered" and [s["text"] for s in r["sentences"]] == kept
    assert r["removed_claims"] == len(model_sentences) - len(kept)
    assert r["missing"] == "Sorudaki iddia onaylı kayıtlarda geçmiyor."


def test_missing_note_cannot_smuggle_premise_names_or_dates():
    svc, _ = make_service(lambda m, msgs: answer(("Kayıtlara göre Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001]),
                                                 missing="Mimar Sinan'ın 1550'de yaptığı bilgisi kayıtlarda yok."))
    assert svc.ask("Ulu Cami'yi Mimar Sinan mı yaptı?", "BUR-0001")["missing"] == ""


def test_all_claims_unsupported_becomes_insufficient():
    svc, _ = make_service(lambda m, msgs: answer(("Ulu Cami 1200 yılında yapılmıştır.", [F001])))
    r = svc.ask("Ulu Cami ne zaman yapıldı?")
    assert r["status"] == "insufficient_evidence" and r["removed_claims"] == 1 and r["facts"] == []


@pytest.mark.parametrize("fail", ["quota", "rate_limited", "moderation", "unavailable", "auth", "paid_usage_detected"])
def test_provider_failure_falls_back_to_source_search(fail):
    svc, _ = make_service(lambda m, msgs: "{}", fail=ProviderError(fail, 500))
    r = svc.ask("Ulu Cami'de kaç kubbe var?")
    assert r["mode"] == "fallback_search" and r["fallback_reason"] == fail
    assert r["search"]["status"] == "answered" and r["search"]["answer"]["fact_id"] == "BUR-0001-F004"


def test_provider_timeout_falls_back_counts_quota_and_is_measured():
    budget = DailyBudget(None, max_calls=40, max_tokens=1_000_000)
    breaker = CircuitBreaker(threshold=2, cooldown_s=60)
    svc, provider = make_service(lambda m, msgs: "{}", fail=ProviderError("timeout"), budget=budget)
    svc.breaker = breaker
    r = svc.ask("Ulu Cami'de kaç kubbe var?")
    assert r["mode"] == "fallback_search" and r["fallback_reason"] == "timeout" and "zamanında" in r["message"]
    assert r["search"]["answer"]["fact_id"] == "BUR-0001-F004"  # kaynaklı arama cevabı
    st = budget.status()
    assert (st["calls"], st["failures"], st["timeouts"]) == (1, 1, 1)  # zaman aşımına uğrayan çağrı da kotadan düşer
    svc.ask("Ulu Cami'de kaç kubbe var?")
    assert breaker.state()["open"] and len(provider.calls) == 2
    # Devre açıkken sağlayıcı çağrılmaz, kota harcanmaz; yeniden deneme yapılmaz.
    assert svc.ask("Ulu Cami'de kaç kubbe var?")["fallback_reason"] == "circuit_open" and len(provider.calls) == 2
    assert budget.status()["calls"] == 2


def test_request_deadline_skips_calls_that_cannot_finish():
    svc, provider = make_service(_vision_responder([{"monument_id": "BUR-0001", "likelihood": "high"}]), models=VISION_MODELS,
                                 settings=GuideSettings(deadline_s=5.0, min_call_s=8.0))
    r = svc.ask("Bu yapıyı kim yaptırdı?", image_bytes=_jpeg())
    assert r["fallback_reason"] == "timeout" and provider.calls == [] and svc.budget.status()["calls"] == 0


def test_each_call_gets_at_most_the_remaining_request_time():
    import time
    seen = []

    def responder(model, messages):
        time.sleep(0.3)
        return _vision_responder([{"monument_id": "BUR-0001", "likelihood": "high"}])(model, messages)
    svc, provider = make_service(responder, models=VISION_MODELS,
                                 settings=GuideSettings(deadline_s=20.0, vision_timeout_s=5.0, timeout_s=30.0, min_call_s=1.0))
    orig = provider.chat
    provider.chat = lambda *a, **k: seen.append(k["timeout_s"]) or orig(*a, **k)
    assert svc.ask("Bu yapıyı kim yaptırdı?", image_bytes=_jpeg())["status"] == "answered"
    assert seen[0] == 5.0 and 19.0 < seen[1] < 19.8  # cevap çağrısı 30 sn değil, isteğin kalan süresi kadar bekler


def test_budget_records_latency_and_migrates_old_file(tmp_path):
    import sqlite3
    db = tmp_path / "eski.sqlite3"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL, prompt_tokens INTEGER NOT NULL, "
                "completion_tokens INTEGER NOT NULL, failures INTEGER NOT NULL)")
    con.execute("INSERT INTO usage VALUES ('2026-10-25', 11, 18841, 2684, 0)")
    con.commit()
    con.close()
    b = DailyBudget(db, 40, 400_000, today=lambda: "2026-10-25")
    assert b.status()["calls"] == 11 and b.status()["remaining_calls"] == 29
    assert b.reserve(10)
    b.settle(10, 100, 20, latency_ms=1200)
    assert b.reserve(10)
    b.settle(10, 0, 0, failed=True, latency_ms=30000, timed_out=True)
    st = DailyBudget(db, 40, 400_000, today=lambda: "2026-10-25").status()
    assert (st["calls"], st["timeouts"], st["max_latency_ms"], st["remaining_calls"]) == (13, 1, 30000, 27)


def test_unparseable_model_output_falls_back():
    svc, _ = make_service(lambda m, msgs: "Üzgünüm, JSON veremem.")
    r = svc.ask("Ulu Cami'de kaç kubbe var?")
    assert r["mode"] == "fallback_search" and r["fallback_reason"] == "parse_error"


def test_daily_budget_blocks_calls_and_falls_back():
    budget = DailyBudget(None, max_calls=1, max_tokens=1_000_000)
    svc, provider = make_service(lambda m, msgs: answer(("Ulu Cami'yi Yıldırım Bayezid yaptırmıştır.", [F001])), budget=budget)
    assert svc.ask("Ulu Cami'yi kim yaptırdı?")["mode"] == "generative"
    r = svc.ask("Ulu Cami'yi kim yaptırdı?")
    assert r["mode"] == "fallback_search" and r["fallback_reason"] == "budget" and len(provider.calls) == 1
    assert budget.status()["calls"] == 1 and budget.status()["remaining_calls"] == 0
    tokens = DailyBudget(None, max_calls=100, max_tokens=10)
    assert not tokens.reserve(50)


def test_budget_persists_counts_only(tmp_path):
    db = tmp_path / "b.sqlite3"
    b = DailyBudget(db, 10, 1000, today=lambda: "2026-10-24")
    assert b.reserve(100)
    b.settle(100, 40, 10)
    b2 = DailyBudget(db, 10, 1000, today=lambda: "2026-10-24")
    assert b2.status()["tokens"] == 50 and b2.status()["calls"] == 1
    assert DailyBudget(db, 10, 1000, today=lambda: "2026-10-25").status()["calls"] == 0


def test_per_minute_limit_blocks_without_calling_provider():
    t = [0.0]
    budget = DailyBudget(None, max_calls=100, max_tokens=1_000_000, max_per_minute=2, clock=lambda: t[0])
    svc, provider = make_service(lambda m, msgs: answer(("Ulu Cami'yi Yıldırım Bayezid yaptırmıştır.", [F001])), budget=budget)
    assert [svc.ask("Ulu Cami'yi kim yaptırdı?")["mode"] for _ in range(2)] == ["generative", "generative"]
    r = svc.ask("Ulu Cami'yi kim yaptırdı?")
    assert r["mode"] == "fallback_search" and r["fallback_reason"] == "busy" and len(provider.calls) == 2
    assert budget.status()["last_minute_calls"] == 2
    t[0] = 61
    assert svc.ask("Ulu Cami'yi kim yaptırdı?")["mode"] == "generative"


def test_budget_and_minute_window_survive_restart(tmp_path):
    db, t = tmp_path / "b.sqlite3", [1000.0]
    b = DailyBudget(db, 40, 1_000_000, today=lambda: "2026-10-25", max_per_minute=2, clock=lambda: t[0])
    for _ in range(2):
        assert b.reserve(10)
        b.settle(10, 5, 5)
    restarted = DailyBudget(db, 40, 1_000_000, today=lambda: "2026-10-25", max_per_minute=2, clock=lambda: t[0])
    assert restarted.status()["calls"] == 2 and not restarted.reserve(10) and restarted.denied == "per_minute"
    t[0] += 61
    assert restarted.reserve(10)


def test_unopenable_budget_db_disables_provider_calls(monkeypatch, tmp_path):
    from app.guide.service import budget_from_env
    blocker = tmp_path / "dosya"
    blocker.write_text("x")
    monkeypatch.setenv("VAKIFNAME_GUIDE_BUDGET_DB", str(blocker / "alt" / "b.sqlite3"))
    b = budget_from_env()
    assert b.max_calls == 0 and not b.reserve(1)


def test_default_budget_stays_below_openrouter_free_limits(monkeypatch):
    from app.guide.service import budget_from_env
    b = budget_from_env()
    assert b.max_calls < 50 and b.max_per_minute < 20


def test_rate_limit_opens_breaker_for_retry_after_and_quota_until_day_reset():
    t = [0.0]
    cb = CircuitBreaker(cooldown_s=30, long_cooldown_s=900, clock=lambda: t[0], until_reset=lambda: 5000)
    cb.failure("rate_limited", retry_after=17)
    assert not cb.allow()
    t[0] = 18
    assert cb.allow()
    cb.failure("quota")
    t[0] = 18 + 4999
    assert not cb.allow()
    t[0] = 18 + 5001
    assert cb.allow()


def test_quota_error_stops_further_provider_calls_today():
    svc, provider = make_service(lambda m, msgs: "{}", fail=ProviderError("quota", 429))
    assert svc.ask("Ulu Cami'yi kim yaptırdı?")["fallback_reason"] == "quota"
    r = svc.ask("Ulu Cami'yi kim yaptırdı?")
    assert r["fallback_reason"] == "circuit_open" and len(provider.calls) == 1


def test_circuit_breaker_opens_after_failures():
    t = [0.0]
    cb = CircuitBreaker(threshold=2, cooldown_s=30, clock=lambda: t[0])
    cb.failure("unavailable")
    assert cb.allow()
    cb.failure("unavailable")
    assert not cb.allow() and cb.state()["open"]
    t[0] = 31
    assert cb.allow()
    cb.failure("auth")
    assert not cb.allow()


def test_no_monument_in_catalog_does_not_call_model():
    svc, provider = make_service(lambda m, msgs: pytest.fail("çağrılmamalı"))
    for q in ("Ayasofya'yı kim yaptırdı?", "Yeşil Cami ne zaman yapıldı?"):
        r = svc.ask(q)
        assert r["status"] == "monument_not_in_catalog" and r["sentences"] == []
    assert provider.calls == []


# --- Fotoğraf -------------------------------------------------------------------------------------------------------

def _jpeg(w=640, h=480, exif=b"Exif\x00\x00GPS 40.18N 29.06E"):
    seg = lambda m, body: b"\xff" + bytes([m]) + struct.pack(">H", len(body) + 2) + body
    sof = b"\x08" + struct.pack(">HH", h, w) + b"\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01"
    return (b"\xff\xd8" + seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00") + seg(0xE1, exif)
            + seg(0xFE, b"Telefon modeli") + seg(0xC0, sof) + seg(0xDA, b"\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00")
            + b"\x12\x34\x56" + b"\xff\xd9")


def _png(extra=True):
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    body = chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
    if extra:
        body += chunk(b"tEXt", b"GPS\x0040.18,29.06") + chunk(b"eXIf", b"MM\x00*")
    return b"\x89PNG\r\n\x1a\n" + body + chunk(b"IDAT", zlib.compress(b"\x00" * 14)) + chunk(b"IEND", b"")


def _webp():
    chunk = lambda t, d: t + struct.pack("<I", len(d)) + d + (b"\x00" if len(d) & 1 else b"")
    vp8x = bytes([0x0C, 0, 0, 0]) + (99).to_bytes(3, "little") + (49).to_bytes(3, "little")
    vp8l = b"\x2f" + ((99) | (49 << 14)).to_bytes(4, "little") + b"\x00" * 4
    body = chunk(b"VP8X", vp8x) + chunk(b"VP8L", vp8l) + chunk(b"EXIF", b"GPS 40.18") + chunk(b"XMP ", b"<x/>")
    return b"RIFF" + struct.pack("<I", 4 + len(body)) + b"WEBP" + body


def test_image_metadata_is_stripped_structurally():
    j = img.clean(_jpeg())
    assert j.mime == "image/jpeg" and (j.width, j.height) == (640, 480)
    assert b"GPS" not in j.data and b"Telefon" not in j.data and b"JFIF" in j.data and j.data.endswith(b"\xff\xd9")
    assert "EXIF/XMP" in j.removed
    p = img.clean(_png())
    assert b"GPS" not in p.data and b"eXIf" not in p.data and p.data.endswith(b"IEND\xaeB`\x82")
    w = img.clean(_webp())
    assert (w.width, w.height) == (100, 50) and b"GPS" not in w.data and b"XMP" not in w.data
    assert w.data[20] & 0x0C == 0  # VP8X bayrakları


@pytest.mark.parametrize("data,msg", [
    (b"GIF89a" + b"\x00" * 40, "Yalnızca JPEG"),
    (_jpeg()[:-60], "bozuk|eksik"),
    (_jpeg(w=20000, h=20000), "sınır"),
    (b"\xff\xd8\xff" + b"\x00" * (img.MAX_BYTES + 1), "MB"),
    (b"", "boş"),
])
def test_bad_images_are_rejected(data, msg):
    import re
    with pytest.raises(img.ImageRejected, match=re.compile(msg)):
        img.clean(data)


def _vision_responder(candidates, description="Fotoğrafta çok kubbeli bir cami ve iki minare görülüyor."):
    def responder(model, messages):
        content = messages[-1]["content"]
        if isinstance(content, list):  # görsel istek
            assert content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
            assert "GPS" not in content[1]["image_url"]["url"]
            return json.dumps({"is_architecture": True, "description": description + " Yapı 1399'da Yıldırım Bayezid tarafından yaptırılmış.",
                               "features": ["çok kubbeli örtü", "iki minare"], "visible_text": "", "candidates": candidates})
        assert "FOTOĞRAF GÖZLEMLERİ" in content and "1399'da Yıldırım" not in content
        return answer(("Fotoğrafta çok kubbeli bir örtü görülüyor.", [PHOTO_ID]),
                      ("Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001]))
    return responder


def test_photo_question_uses_nemotron_for_vision_and_answer_and_strips_metadata():
    import base64
    svc, provider = make_service(_vision_responder([{"monument_id": "BUR-0001", "likelihood": "high", "reason": "çok kubbe"}]),
                                 models=VISION_MODELS)
    r = svc.ask("Bu yapıyı kim yaptırdı?", image_bytes=_jpeg())
    assert [c["model"] for c in provider.calls] == [DEFAULT_MODEL, DEFAULT_MODEL]
    assert all(c["json_mode"] for c in provider.calls)
    assert r["status"] == "answered" and r["monument"]["monument_id"] == "BUR-0001"
    assert "1399" not in r["photo"]["description"] and "iki minare" in r["photo"]["description"]
    assert "EXIF/XMP" in r["photo"]["metadata_removed"] and "saklanmaz" in r["notice"]
    assert r["usage"]["calls"] == 2
    url = provider.calls[0]["messages"][-1]["content"][1]["image_url"]["url"]
    assert b"GPS" not in base64.b64decode(url.split(",", 1)[1])


# Görev 18 gerçek testinde Koza Han giriş cephesi fotoğrafına (commons/BUR-0009/6d934f8e20d3a72f) modelin verdiği
# gözlem; cephe tuğla ve taştır, model "tuğla ve tahta" dedi.
KOZA_OBSERVATION = {
    "is_architecture": True,
    "description": "Fotoğrafta, tahta ve tuğla ile yapılmış bir yapının cephe görünümü yer alıyor. Üst kısımda büyük "
                   "harflerle \"KOZA HAN\" yazısı, giriş kapısının üzerinde ise daha küçük bir \"KOZA HAN\" levhası "
                   "bulunuyor. Giriş kapısı kavisli bir kemerle çevrili ve iki yanında simetrik olarak pencere ve kemerli "
                   "boşluklar yer alıyor.",
    "features": ["tuğla ve tahta malzeme", "kemerli giriş kapısı", "pencere", "cephe üzerindeki yazı",
                 "çatı üzerindeki duman boruları"],
    "visible_text": "KOZA HAN",
    "candidates": [{"monument_id": "BUR-0009", "likelihood": "high", "reason": "tabelada KOZA HAN yazıyor"}],
}


def test_koza_han_wrong_material_from_photo_is_never_shown_or_used():
    seen = {}

    def responder(model, messages):
        content = messages[-1]["content"]
        if isinstance(content, list):
            return json.dumps(KOZA_OBSERVATION, ensure_ascii=False)
        seen["answer_prompt"] = content
        return answer(("Fotoğrafta tuğla ve tahta malzemeden yapılmış bir cephe görülüyor.", [PHOTO_ID]),
                      ("Giriş kapısı kavisli bir kemerle çevrilidir.", [PHOTO_ID]),
                      ("Koza Han ahşaptan yapılmıştır.", ["BUR-0009-F001"]),
                      ("Koza Han'ı Sultan II. Bayezid yaptırmıştır.", ["BUR-0009-F001"]))
    svc, provider = make_service(responder, models=VISION_MODELS)
    r = svc.ask("Bu fotoğrafta hangi mimari özellikler görülüyor?", image_bytes=_jpeg())
    shown = " ".join([r["photo"]["description"], *r["photo"]["features"], *(s["text"] for s in r["sentences"])]).lower()
    assert "tahta" not in shown and "ahşap" not in shown and "tuğla" not in shown
    # Yanlış malzeme, cevap istemine "fotoğraf gözlemi" olarak da taşınmaz.
    observations = seen["answer_prompt"].split("FOTOĞRAF GÖZLEMLERİ", 1)[1].split("ZİYARETÇİ SORUSU", 1)[0]
    assert "tahta" not in observations and "tuğla" not in observations
    # Görünen özellikler ve okunan tabela kalır; tarihî bilgi yalnızca kayıttan.
    assert "KOZA HAN" in r["photo"]["description"] and "kemerli giriş kapısı" in r["photo"]["features"]
    assert [s["text"] for s in r["sentences"]] == ["Giriş kapısı kavisli bir kemerle çevrilidir.",
                                                   "Koza Han'ı Sultan II. Bayezid yaptırmıştır."]
    assert r["removed_claims"] == 2 and r["monument"]["monument_id"] == "BUR-0009" and len(provider.calls) == 2


def test_photo_with_face_is_rejected_before_any_provider_call():
    faces = FakeFaceScreen(faces=1)
    svc, provider = make_service(lambda m, msgs: pytest.fail("çağrılmamalı"), models=VISION_MODELS, face_screen=faces)
    with pytest.raises(img.ImageRejected, match="yüz"):
        svc.ask("Bu yapıyı kim yaptırdı?", image_bytes=_jpeg())
    assert provider.calls == [] and faces.seen == 1


def test_photo_is_refused_when_face_screen_is_unavailable(tmp_path):
    svc, provider = make_service(lambda m, msgs: pytest.fail("çağrılmamalı"), models=VISION_MODELS,
                                 face_screen=FaceScreen(tmp_path / "yok"))
    assert not svc.photo_enabled()
    with pytest.raises(img.ImageRejected, match="gizlilik denetimi"):
        svc.ask("Bu yapıyı kim yaptırdı?", image_bytes=_jpeg())
    assert provider.calls == []


@pytest.mark.skipif(not FaceScreen(DEFAULT_MODEL_DIR).available or not MEDIA.is_dir(),
                    reason="yerel yüz modelleri veya katalog görselleri yok")
def test_real_face_screen_passes_catalog_monument_photos():
    fs = FaceScreen(DEFAULT_MODEL_DIR)
    photos = sorted(MEDIA.iterdir())[:20]
    assert photos and all(fs.faces(p.read_bytes()) == 0 for p in photos)


CATALOG_ORDER = ["BUR-0001", "BUR-0003", "BUR-0005", "BUR-0007", "BUR-0008", "BUR-0009", "BUR-0013", "BUR-0014",
                 "BUR-0019", "BUR-0020"]

# Görev 21 regresyon örnekleri: model çıktıları (sahte VLM). Kullanıcının bildirdiği durum: Bursa Ulu Camii'ne
# benzemeyen, büyük merkezî kubbeli, minareli, avlulu (kurgusal) bir yapı Ulu Cami seçimine yönlendirildi.
FICTIONAL_MOSQUE = {
    "is_architecture": True, "building_type": "cami",
    "description": "Fotoğrafta büyük merkezî bir kubbe, çevresinde yarım kubbeler ve dört ince minare görülüyor. Önünde "
                   "revaklarla çevrili geniş bir avlu var. Osmanlı üslubunda bir yapı.",
    "features": ["büyük merkezî kubbe", "dört minare", "revaklı avlu", "Bursa Ulu Camii'ne benzer kubbe"],
    "architecture_explanation": "Merkezî kubbe, iç mekânı ayaksız tek bir büyük alan olarak örter. Revak, avluyu çevreleyen "
                                "üstü örtülü kemerli geçittir. Bu düzen 16. yüzyılda yaygınlaşmıştır.",
    "visible_text": "",
    "identity": {"identifiable": "no", "reason": "Ayırt edici bir yazı veya çevre ipucu görünmüyor."},
    "synthetic_signs": ["Minarelerin şerefe sayıları birbirinden farklı görünüyor; görsel kurgusal olabilir.",
                        "Bu görsel kesinlikle yapay zekâ ile üretilmiştir."],
    # Model yine de zayıf bir benzerlik yazarsa (aynı tür) bu, öneriye dönüşmemeli.
    "catalog_match": [{"monument_id": "BUR-0001", "likelihood": "medium", "reason": "kubbeli cami"},
                      {"monument_id": "BUR-0003", "likelihood": "low", "reason": "minareli"}],
}
NON_CATALOG_REAL = {
    "is_architecture": True, "building_type": "cami",
    "description": "Yapı Edirne'deki Selimiye Camii'ne çok benziyor. Tek büyük kubbe dört ince, yüksek minareyle çevrili.",
    "features": ["tek büyük kubbe", "dört kalem minare", "Selimiye tipi plan"],
    "architecture_explanation": "Kalem minare, gövdesi ince ve yüksek minaredir. Mimar Sinan'ın eseridir.",
    "visible_text": "",
    "identity": {"identifiable": "yes", "reason": "Dört kalem minare ve tek büyük kubbe tanınmış bir yapıya işaret ediyor."},
    "synthetic_signs": [], "catalog_match": [],
}
KOZA_MATCH = {**KOZA_OBSERVATION, "building_type": "han", "architecture_explanation": "Kemerli giriş, avluya açılan ana kapıdır.",
              "identity": {"identifiable": "yes", "reason": "Cephede okunabilir bir yazı var."}, "synthetic_signs": [],
              "catalog_match": [{"monument_id": "BUR-0009", "likelihood": "high", "reason": "KOZA HAN yazısı"}]}
KOZA_MATCH.pop("candidates")


def _vlm(obs, calls=None):
    def responder(model, messages):
        if calls is not None:
            calls.append("vision" if isinstance(messages[-1]["content"], list) else "answer")
        if isinstance(messages[-1]["content"], list):
            return json.dumps(obs, ensure_ascii=False)
        return answer(("Koza Han'ı Sultan II. Bayezid yaptırmıştır.", ["BUR-0009-F001"]))
    return responder


def _assert_not_matched(r, named=()):
    assert r["status"] == "photo_not_matched" and r["mode"] == "generative"
    assert r["message"] == NOT_MATCHED_MESSAGE
    assert [o["monument_id"] for o in r["options"]] == list(named)  # en yakın eser önerilmez
    assert [o["monument_id"] for o in r["manual_options"]] == CATALOG_ORDER  # tarafsız, katalog sırası
    assert r["actions"] == ["explain_architecture", "upload_another", "choose_manually"]
    assert r["sentences"] == [] and r["facts"] == [] and r["monument"] is None


@pytest.mark.parametrize("page", [None, "BUR-0001"])
def test_fictional_domed_mosque_is_not_steered_to_ulu_cami(page):
    calls = []
    svc, _ = make_service(_vlm(FICTIONAL_MOSQUE, calls), models=VISION_MODELS)
    r = svc.ask("Bu yapı hakkında bilgi verir misin?", page, image_bytes=_jpeg())
    _assert_not_matched(r)
    assert calls == ["vision"]  # tarihî cevap üretilmez, kota harcanmaz
    p = r["photo"]
    assert p["building_type"] == "cami" and p["candidates"] == [] and p["identity"]["identifiable"] == "no"
    assert "Ulu" not in json.dumps(p, ensure_ascii=False) and "Osmanlı" not in p["description"]
    assert "büyük merkezî kubbe" in p["features"] and "revaklı avlu" in p["features"]
    assert "16. yüzyıl" not in p["architecture_explanation"] and "Revak, avluyu çevreleyen" in p["architecture_explanation"]
    # Yapay üretim işareti yalnızca olasılık olarak kalır; kesin yargı atılır.
    assert p["synthetic_signs"] == ["Minarelerin şerefe sayıları birbirinden farklı görünüyor; görsel kurgusal olabilir."]


def test_real_building_outside_catalog_is_not_named_or_matched():
    svc, _ = make_service(_vlm(NON_CATALOG_REAL), models=VISION_MODELS)
    r = svc.ask("Bu cami ne zaman yapıldı?", image_bytes=_jpeg())
    _assert_not_matched(r)
    shown = json.dumps(r, ensure_ascii=False)
    assert "Selimiye" not in shown and "Edirne" not in shown and "Sinan" not in shown  # doğrulanmamış kimlik/bani yok
    assert r["photo"]["description"] == "Tek büyük kubbe dört ince, yüksek minareyle çevrili."
    assert r["photo"]["identity"]["identifiable"] == "yes"  # belirlenebilir olduğu söylenir, ad verilmez


@pytest.mark.parametrize("page", [None, "BUR-0009"])
def test_correct_catalog_photo_is_matched_and_answered_from_records(page):
    calls = []
    svc, _ = make_service(_vlm(KOZA_MATCH, calls), models=VISION_MODELS)
    r = svc.ask("Bu yapıyı kim yaptırdı?", page, image_bytes=_jpeg())
    assert r["status"] == "answered" and r["monument"]["monument_id"] == "BUR-0009" and calls == ["vision", "answer"]
    assert r["photo"]["candidates"] == [{"monument_id": "BUR-0009", "likelihood": "high", "name": "Koza Han"}]
    assert r["sentences"][0]["sources"] == ["BUR-0009-F001"]  # tarihî bilgi kayıttan, gözlem ayrı alanda


def test_catalog_photo_on_another_monuments_page_is_offered_not_assigned():
    svc, _ = make_service(_vlm(KOZA_MATCH), models=VISION_MODELS)
    r = svc.ask("Bu yapıyı kim yaptırdı?", "BUR-0001", image_bytes=_jpeg())
    assert r["status"] == "clarification_required" and [o["monument_id"] for o in r["options"]] == ["BUR-0009"]
    assert "BUR-0001" not in [o["monument_id"] for o in r["options"]] and r["sentences"] == []
    assert len(r["manual_options"]) == 10 and "choose_manually" in r["actions"]


@pytest.mark.parametrize("matches,page,answered", [
    ([{"monument_id": "BUR-0009", "likelihood": "medium"}], "BUR-0009", False),   # orta benzerlik sayfa eserine atanmaz
    ([{"monument_id": "BUR-0009", "likelihood": "high"}, {"monument_id": "BUR-0013", "likelihood": "high"}], None, False),
    ([{"monument_id": "BUR-0009", "likelihood": "low"}], "BUR-0009", False),
    ([], "BUR-0009", False),
])
def test_only_a_single_high_match_identifies_the_photo(matches, page, answered):
    svc, _ = make_service(_vlm({**KOZA_MATCH, "catalog_match": matches}), models=VISION_MODELS)
    r = svc.ask("Bu yapıyı kim yaptırdı?", page, image_bytes=_jpeg())
    assert (r["status"] == "answered") is answered and r["sentences"] == []
    if len(matches) == 2:
        assert r["status"] == "clarification_required" and [o["monument_id"] for o in r["options"]] == ["BUR-0009", "BUR-0013"]
    else:
        _assert_not_matched(r)


def test_catalog_match_contradicting_seen_building_type_is_rejected():
    # Model "yüksek" Koza Han dese de fotoğrafta cami gördüğünü söylüyorsa (han ≠ cami) eşleşme kabul edilmez.
    svc, _ = make_service(_vlm({**KOZA_MATCH, "building_type": "cami"}), models=VISION_MODELS)
    _assert_not_matched(svc.ask("Bu yapıyı kim yaptırdı?", image_bytes=_jpeg()))


def test_naming_a_monument_in_the_question_does_not_confirm_a_non_matching_photo():
    svc, _ = make_service(_vlm(FICTIONAL_MOSQUE), models=VISION_MODELS)
    r = svc.ask("Bu Ulu Cami mi?", image_bytes=_jpeg())
    # Ziyaretçinin andığı eser yalnızca onun açık seçimi olarak düğme olur; "evet" denmez.
    _assert_not_matched(r, named=["BUR-0001"])
    svc2, _ = make_service(_vlm({**FICTIONAL_MOSQUE, "catalog_match": [{"monument_id": "BUR-0001", "likelihood": "high"}]}),
                           models=VISION_MODELS)
    assert svc2.ask("Bu Ulu Cami mi?", image_bytes=_jpeg())["status"] in ("answered", "insufficient_evidence")


def test_non_architecture_photo_offers_new_photo_or_manual_choice():
    svc, _ = make_service(_vlm({"is_architecture": False, "description": "Bir kedi görülüyor.", "catalog_match": []}),
                          models=VISION_MODELS)
    r = svc.ask("Bu ne?", image_bytes=_jpeg())
    assert r["status"] == "monument_not_identified" and r["options"] == [] and len(r["manual_options"]) == 10
    assert r["actions"] == ["upload_another", "choose_manually"]


def test_photo_citation_is_rejected_when_no_photo_was_sent():
    # Ziyaretçi eseri kendi seçtiğinde fotoğraf yeniden gönderilmez; önceki gözlem eser kaydı gibi kullanılamaz.
    svc, _ = make_service(lambda m, msgs: answer(("Fotoğraftaki yapı Koza Han'dır.", [PHOTO_ID]),
                                                 ("Koza Han'ı Sultan II. Bayezid yaptırmıştır.", ["BUR-0009-F001"])))
    r = svc.ask("Bu yapıyı kim yaptırdı?", "BUR-0009",
                history=[{"question": "(fotoğraf) Bu yapı ne?", "answer": "Fotoğraftan gözlem: kemerli bir giriş."}])
    assert [s["text"] for s in r["sentences"]] == ["Koza Han'ı Sultan II. Bayezid yaptırmıştır."] and r["removed_claims"] == 1


def test_vision_prompt_is_open_world_and_puts_catalog_after_the_image():
    seen = {}

    def responder(model, messages):
        seen["system"], seen["user"] = messages[0]["content"], messages[-1]["content"]
        return json.dumps(FICTIONAL_MOSQUE, ensure_ascii=False)
    svc, _ = make_service(responder, models=VISION_MODELS)
    svc.ask("Bu yapı ne?", image_bytes=_jpeg())
    parts = [p["type"] for p in seen["user"]]
    assert parts == ["text", "image_url", "text"] and "BUR-0001" not in seen["user"][0]["text"]
    assert "BUR-0001" in seen["user"][2]["text"] and "olmak zorunda değildir" in seen["user"][2]["text"]
    assert "En yakın" in seen["system"] and "synthetic_signs" in seen["system"] and "AŞAMA 1" in seen["system"]


def test_photo_observation_is_kept_when_only_the_answer_call_fails():
    calls = []

    def responder(model, messages):
        calls.append(1)
        if isinstance(messages[-1]["content"], list):
            return json.dumps({**KOZA_OBSERVATION, "description": "Giriş kapısı kavisli bir kemerle çevrili."})
        raise ProviderError("unavailable", 502)
    svc, _ = make_service(responder, models=VISION_MODELS)
    r = svc.ask("Bu yapı ne zaman yapıldı?", "BUR-0009", image_bytes=_jpeg())
    assert r["mode"] == "fallback_search" and r["photo"]["description"] == "Giriş kapısı kavisli bir kemerle çevrili."
    # Görsel çağrı + hızlı 502'den sonra bir kez yeniden denenen cevap çağrısı.
    assert "analiz edilemedi" not in r["message"] and r["usage"]["calls"] == 1 and len(calls) == 3


def test_photo_without_vision_model_is_reported_not_answered_from_page():
    svc, _ = make_service(_vision_responder([]), models=TEXT_ONLY_MODELS)
    r = svc.ask("Bu yapı ne zaman yapıldı?", "BUR-0001", image_bytes=_jpeg())
    assert r["status"] == "photo_analysis_failed" and r["fallback_reason"] == "vision_unsupported" and r["search"] is None


# --- API ------------------------------------------------------------------------------------------------------------

TESTER_KEY = "test-anahtari-0123456789"
GUIDE = {"X-Vakifname-Guide": "1"}


def _client(monkeypatch, tmp_path, mode="testers", responder=None):
    monkeypatch.setenv("VAKIFNAME_GUIDE_MODE", mode)
    key = tmp_path / "tester"
    key.write_text(TESTER_KEY)
    os.chmod(key, 0o600)
    monkeypatch.setenv("VAKIFNAME_GUIDE_TESTER_KEY_FILE", str(key))
    app = create_app(public_catalog_file=CATALOG, demo_api=False, ask_background=False)
    provider = MockProvider(responder or (lambda m, msgs: answer(("Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001]))),
                            models=VISION_MODELS)
    app.state.guide.provider = provider
    app.state.guide.face_screen = FakeFaceScreen()
    return TestClient(app), provider


def test_guide_is_off_by_default(tmp_path):
    with TestClient(create_app(public_catalog_file=CATALOG, demo_api=False, ask_background=False)) as c:
        assert c.get("/guide/status").json() == {"enabled": False, "tester_login": False}
        assert c.post("/guide/ask", json={"question": "Ulu Cami'yi kim yaptırdı?"}).status_code == 503


def test_testers_mode_uses_cookie_session_not_key_in_url_or_header(monkeypatch, tmp_path, caplog):
    c, provider = _client(monkeypatch, tmp_path)
    q = {"question": "Ulu Cami'yi gizli-soru-123 kim yaptırdı?"}
    assert c.get("/guide/status").json() == {"enabled": False, "tester_login": True}
    assert c.post("/guide/ask", json=q).status_code == 503
    # Eski yöntem (anahtar başlıkta) artık kabul edilmez.
    assert c.post("/guide/ask", json=q, headers={"X-Vakifname-Guide-Key": TESTER_KEY}).status_code == 503
    assert c.post("/guide/session", json={"key": "yanlis-anahtar-000000"}, headers=GUIDE).status_code == 401
    assert c.post("/guide/session", json={"key": TESTER_KEY}).status_code == 401  # CSRF başlığı yok
    with caplog.at_level(logging.INFO):
        r = c.post("/guide/session", json={"key": TESTER_KEY}, headers=GUIDE)
    assert r.status_code == 204
    cookie = r.headers["set-cookie"]
    assert "httponly" in cookie.lower() and "samesite=strict" in cookie.lower() and "path=/guide" in cookie.lower()
    assert TESTER_KEY not in cookie and TESTER_KEY not in caplog.text  # anahtar çerezde ve logda yok
    assert c.post("/guide/ask", json=q).status_code == 503  # çerez var ama CSRF başlığı yok
    with caplog.at_level(logging.INFO):
        r = c.post("/guide/ask", json=q, headers=GUIDE)
    assert r.status_code == 200 and r.json()["status"] == "answered" and "_removed" not in r.json()
    assert r.headers["cache-control"] == "no-store"
    assert "gizli-soru-123" not in caplog.text  # soru metni loglanmaz
    st = c.get("/guide/status", headers=GUIDE).json()
    assert st["enabled"] and "detail" in st
    assert c.delete("/guide/session", headers=GUIDE).status_code == 204
    c.cookies.clear()
    assert c.post("/guide/ask", json=q, headers=GUIDE).status_code == 503


def test_tester_session_is_rate_limited_and_closed_outside_testers_mode(monkeypatch, tmp_path):
    c, _ = _client(monkeypatch, tmp_path)
    codes = [c.post("/guide/session", json={"key": "yanlis-anahtar-000000"}, headers=GUIDE).status_code for _ in range(6)]
    assert codes == [401] * 5 + [429]
    c2, _ = _client(monkeypatch, tmp_path, mode="on")
    assert c2.post("/guide/session", json={"key": TESTER_KEY}, headers=GUIDE).status_code == 404


def test_tester_sessions_expire_and_store_only_digests():
    from app.guide_routes import TesterSessions
    t = [0.0]
    s = TesterSessions(ttl_s=10, clock=lambda: t[0])
    sid = s.create()
    assert s.valid(sid) and sid.encode() not in b"".join(s._sessions)
    t[0] = 11
    assert not s.valid(sid) and not s.valid(None) and not s.valid("x" * 200)


def test_api_validates_images_and_body_size(monkeypatch, tmp_path):
    import base64
    c, provider = _client(monkeypatch, tmp_path, mode="on")
    bad = {"question": "Bu ne?", "image": {"data": base64.b64encode(b"GIF89a" + b"\x00" * 64).decode(), "consent": True}}
    r = c.post("/guide/ask", json=bad)
    assert r.status_code == 400 and "JPEG" in r.json()["detail"] and provider.calls == []
    big = b'{"question": "x", "image": {"data": "' + b"A" * (10 * 1024 * 1024) + b'"}}'
    assert c.post("/guide/ask", content=big, headers={"Content-Type": "application/json"}).status_code == 413
    assert c.post("/guide/ask", json={"question": "Ulu Cami?", "extra": 1}).status_code == 422
    assert c.post("/guide/ask", json={"question": "x" * 301}).status_code == 422
    assert c.post("/guide/ask", json={"question": "Ulu Cami?", "monument_id": "BUR-9999"}).status_code == 404


def test_api_requires_photo_consent_and_rejects_faces(monkeypatch, tmp_path):
    import base64
    c, provider = _client(monkeypatch, tmp_path, mode="on")
    data = base64.b64encode(_jpeg()).decode()
    assert c.post("/guide/ask", json={"question": "Bu ne?", "image": {"data": data}}).status_code == 422
    assert c.post("/guide/ask", json={"question": "Bu ne?", "image": {"data": data, "consent": False}}).status_code == 422
    c.app.state.guide.face_screen = FakeFaceScreen(faces=2)
    r = c.post("/guide/ask", json={"question": "Bu ne?", "image": {"data": data, "consent": True}})
    assert r.status_code == 400 and "yüz" in r.json()["detail"] and provider.calls == []


def test_status_reports_photo_only_with_face_screen_and_remaining_quota(monkeypatch, tmp_path):
    c, _ = _client(monkeypatch, tmp_path, mode="on")
    st = c.get("/guide/status").json()
    assert st["photo"] is True and st["remaining_today"] == 40 and st["deadline_s"] == 50 and "tester" not in st
    c.app.state.guide.face_screen = None
    assert c.get("/guide/status").json()["photo"] is False


def test_api_rate_limit(monkeypatch, tmp_path):
    monkeypatch.setenv("VAKIFNAME_GUIDE_RATE", "2/10/10")
    c, _ = _client(monkeypatch, tmp_path, mode="on")
    codes = [c.post("/guide/ask", json={"question": "Ulu Cami'yi kim yaptırdı?"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_same_session_cannot_send_a_second_question_while_first_is_running(monkeypatch, tmp_path):
    c, provider = _client(monkeypatch, tmp_path)
    assert c.post("/guide/session", json={"key": TESTER_KEY}, headers=GUIDE).status_code == 204
    sid = c.cookies.get("vakifname_guide_session")
    q = {"question": "Ulu Cami'yi kim yaptırdı?"}
    slot = c.app.state.guide_inflight.acquire(sid)  # ilk soru hâlâ işleniyor
    r = c.post("/guide/ask", json=q, headers=GUIDE)
    assert r.status_code == 409 and "bekleyin" in r.json()["detail"] and provider.calls == []
    c.app.state.guide_inflight.release(slot)
    assert c.post("/guide/ask", json=q, headers=GUIDE).status_code == 200
    assert c.post("/guide/ask", json=q, headers=GUIDE).status_code == 200  # bitmiş istek kilidi bırakır


def test_existing_ask_endpoint_unchanged(monkeypatch, tmp_path):
    c, provider = _client(monkeypatch, tmp_path, mode="on")
    r = c.post("/monuments/ask", json={"question": "Ulu Cami'de kaç kubbe var?"})
    assert r.status_code == 200 and r.json()["answer_method"] == "approved_text_retrieval" and provider.calls == []
