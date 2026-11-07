"""Evren LLM API sağlayıcısı (Anthropic Messages uyumlu). Ağ yoktur: bütün istekler `httpx.MockTransport` ile
karşılanır; anahtar sahte bir test değeridir. Gerçek API testi en altta ve yalnızca açıkça istenirse çalışır."""

import json
import logging
import os
import re
import time
from pathlib import Path

import httpx
import pytest

from app.ask.service import AskService
from app.guide.budget import DailyBudget
from app.guide.evren_provider import (DEFAULT_EVREN_BASE_URL, DEFAULT_EVREN_MODEL, JSON_INSTRUCTION, EvrenProvider,
                                      check_base_url, json_text, to_anthropic)
from app.guide.provider import ProviderError
from app.guide.secret import KeyStatus, evren_key_path, load_evren_key
from app.guide.service import GuideService, GuideSettings
from app.public_catalog import PublicCatalogRepository

CATALOG = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
F001 = "BUR-0001-F001"
KEY = "evren-test-anahtari-0123456789"  # sahte; gerçek anahtar değildir


class FakeFaceScreen:
    available = True

    def faces(self, data):
        return 0


def _evren(handler, key=KEY, status=KeyStatus.OK, **kw):
    loader = (lambda: (key, status)) if key else (lambda: (None, status))
    return EvrenProvider("https://evren.invalid", key_loader=loader, transport=httpx.MockTransport(handler), **kw)


def _message(text="Merhaba.", model=DEFAULT_EVREN_MODEL, stop="end_turn", blocks=None, usage=None):
    return {"id": "msg_01", "type": "message", "role": "assistant", "model": model,
            "content": blocks if blocks is not None else [{"type": "text", "text": text}],
            "stop_reason": stop, "usage": usage or {"input_tokens": 12, "output_tokens": 5}}


def _ok(body, seen=None, status=200, headers=None):
    def handler(request: httpx.Request):
        if seen is not None:
            seen.append(request)
        return httpx.Response(status, json=body, headers=headers or {})
    return handler


MSGS = [{"role": "system", "content": "Sen bir rehbersin."}, {"role": "user", "content": "Selam"}]


# --- Başarılı istek ve biçim dönüşümü --------------------------------------------------------------------------------

def test_successful_call_uses_anthropic_messages_format_and_reads_usage():
    seen = []
    usage = {"input_tokens": 12, "cache_read_input_tokens": 3, "output_tokens": 5}
    p = _evren(_ok(_message("Bursa'ya hoş geldin.", usage=usage), seen))
    r = p.chat(DEFAULT_EVREN_MODEL, MSGS, max_tokens=300, temperature=0.2)
    req = seen[0]
    assert req.method == "POST" and req.url.path == "/v1/messages" and req.url.host == "evren.invalid"
    assert req.headers["x-api-key"] == KEY and req.headers["anthropic-version"] == "2023-06-01"
    assert "authorization" not in req.headers
    body = json.loads(req.content)
    assert body == {"model": "glm-5.3", "max_tokens": 300, "temperature": 0.2, "stream": False,
                    "system": "Sen bir rehbersin.", "messages": [{"role": "user", "content": "Selam"}]}
    assert r.text == "Bursa'ya hoş geldin." and r.model == "glm-5.3" and r.finish_reason == "stop"
    assert (r.prompt_tokens, r.completion_tokens, r.cost) == (15, 5, 0.0) and r.request_id == "msg_01"


def test_system_messages_are_moved_to_system_field_and_roles_merged():
    system, msgs = to_anthropic([
        {"role": "system", "content": "Kural 1."},
        {"role": "user", "content": "Önceki soru"},
        {"role": "assistant", "content": "Önceki cevap"},
        {"role": "system", "content": [{"type": "text", "text": "Kural 2."}]},
        {"role": "user", "content": "Kayıtlar"},
        {"role": "user", "content": [{"type": "text", "text": "Soru"}, {"type": "text", "text": "  "}]},
    ])
    assert system == "Kural 1.\n\nKural 2."
    assert msgs == [{"role": "user", "content": "Önceki soru"}, {"role": "assistant", "content": "Önceki cevap"},
                    {"role": "user", "content": "Kayıtlar\n\nSoru"}]


def test_images_become_base64_blocks_and_remote_urls_are_refused():
    _, msgs = to_anthropic([{"role": "user", "content": [
        {"type": "text", "text": "Bu ne?"}, {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,QUJD"}}]}])
    assert msgs[0]["content"][1] == {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "QUJD"}}
    with pytest.raises(ProviderError) as e:
        to_anthropic([{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "https://x.invalid/a.jpg"}}]}])
    assert e.value.kind == "bad_request"


@pytest.mark.parametrize("messages", [
    [{"role": "assistant", "content": "ilk mesaj asistandan"}],
    [{"role": "system", "content": "yalnızca sistem"}],
    [{"role": "tool", "content": "x"}],
])
def test_invalid_message_order_or_role_is_rejected_before_any_request(messages):
    calls = []
    p = _evren(_ok(_message(), calls))
    with pytest.raises(ProviderError) as e:
        p.chat(DEFAULT_EVREN_MODEL, messages, 100)
    assert e.value.kind == "bad_request" and calls == []


# --- Anahtar ---------------------------------------------------------------------------------------------------------

def test_missing_or_insecure_key_disables_provider_without_request():
    calls = []
    p = _evren(_ok(_message(), calls), key=None, status=KeyStatus.MISSING)
    assert p.available() == (False, KeyStatus.MISSING)
    with pytest.raises(ProviderError) as e:
        p.chat(DEFAULT_EVREN_MODEL, MSGS, 100)
    assert e.value.kind == "no_key"
    p = _evren(_ok(_message(), calls), key=None, status=KeyStatus.INSECURE)
    with pytest.raises(ProviderError) as e:
        p.chat(DEFAULT_EVREN_MODEL, MSGS, 100)
    assert e.value.kind == KeyStatus.INSECURE and calls == []


def test_evren_key_is_separate_from_openrouter_key(monkeypatch, tmp_path):
    other = tmp_path / "openrouter_api_key"
    other.write_text("openrouter-anahtari-123\n")
    monkeypatch.setenv("VAKIFNAME_OPENROUTER_KEY_FILE", str(other))
    monkeypatch.setenv("CREDENTIALS_DIRECTORY", str(tmp_path))  # içinde yalnızca OpenRouter anahtarı var
    monkeypatch.setenv("VAKIFNAME_EVREN_KEY_FILE", str(tmp_path / "yok"))
    assert evren_key_path() == tmp_path / "yok"
    assert load_evren_key() == (None, KeyStatus.MISSING)
    (tmp_path / "evren_api_key").write_text(KEY + "\n")
    (tmp_path / "evren_api_key").chmod(0o600)  # POSIX'te anahtar dosyası yalnızca sahibince okunmalı (Windows'ta denetlenmez)
    assert evren_key_path() == tmp_path / "evren_api_key"  # systemd LoadCredential önceliklidir
    assert load_evren_key() == (KEY, KeyStatus.OK)


# --- Hatalar ---------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("status,etype,kind", [
    (401, "authentication_error", "auth"),
    (403, "permission_error", "auth"),
    (402, "billing_error", "quota"),
    (429, "rate_limit_error", "rate_limited"),
    (400, "invalid_request_error", "bad_request"),
    (404, "not_found_error", "bad_request"),
    (500, "api_error", "unavailable"),
    (529, "overloaded_error", "unavailable"),
])
def test_http_errors_are_classified_and_never_carry_message_or_key(status, etype, kind):
    body = {"type": "error", "error": {"type": etype, "message": f"anahtar {KEY} ve soru: Ulu Cami gizli metin"}}
    p = _evren(_ok(body, status=status, headers={"retry-after": "7"}))
    with pytest.raises(ProviderError) as e:
        p.chat(DEFAULT_EVREN_MODEL, MSGS, 100)
    err = e.value
    assert (err.kind, err.status, err.code) == (kind, status, etype)
    assert err.retry_after == 7
    blob = f"{err} {err.code} {err.upstream} {err.args}"
    assert KEY not in blob and "gizli" not in blob


def test_error_inside_200_body_is_not_treated_as_answer():
    p = _evren(_ok({"type": "error", "error": {"type": "overloaded_error", "message": "x"}}))
    with pytest.raises(ProviderError) as e:
        p.chat(DEFAULT_EVREN_MODEL, MSGS, 100)
    assert e.value.kind == "unavailable" and e.value.status == 502


def test_timeout_is_reported_as_timeout():
    def handler(request):
        raise httpx.ReadTimeout("zaman aşımı", request=request)
    with pytest.raises(ProviderError) as e:
        _evren(handler).chat(DEFAULT_EVREN_MODEL, MSGS, 100, timeout_s=1)
    assert e.value.kind == "timeout"


class _Trickle(httpx.SyncByteStream):
    def __iter__(self):
        for _ in range(100):
            time.sleep(0.03)
            yield b" "
        yield json.dumps(_message()).encode()


def test_deadline_covers_whole_response_even_with_keepalive_bytes():
    p = _evren(lambda request: httpx.Response(200, stream=_Trickle()))
    t0 = time.monotonic()
    with pytest.raises(ProviderError) as e:
        p.chat(DEFAULT_EVREN_MODEL, MSGS, 100, timeout_s=0.3)
    assert e.value.kind == "timeout" and time.monotonic() - t0 < 2


def test_connection_error_is_unavailable_with_class_name_only():
    def handler(request):
        raise httpx.ConnectError("bağlanamadı", request=request)
    with pytest.raises(ProviderError) as e:
        _evren(handler).chat(DEFAULT_EVREN_MODEL, MSGS, 100)
    assert e.value.kind == "unavailable" and e.value.code == "transport:ConnectError"


# --- Model doğrulaması ve bozuk yanıtlar -----------------------------------------------------------------------------

@pytest.mark.parametrize("served,ok", [("glm-5.3", True), ("GLM-5.3", True), ("glm-5.3-20261001", True),
                                       ("glm-4.6", False), ("claude-sonnet-4-5", False), ("glm-5.30", False)])
def test_answer_from_another_model_is_rejected(served, ok):
    p = _evren(_ok(_message(model=served)))
    if ok:
        assert p.chat(DEFAULT_EVREN_MODEL, MSGS, 100).text == "Merhaba."
    else:
        with pytest.raises(ProviderError) as e:
            p.chat(DEFAULT_EVREN_MODEL, MSGS, 100)
        assert e.value.kind == "model_mismatch"


GEMMA = "gemma-4-31b"


@pytest.mark.parametrize("served,ok", [(GEMMA, True), ("Gemma-4-31B", True), ("gemma-4-31b-it", True),
                                       ("gemma-4-27b", False), ("glm-5.3", False)])
def test_gemma_model_is_sent_unchanged_and_answer_model_is_verified(served, ok):
    seen = []
    p = _evren(_ok(_message(model=served), seen), models=(GEMMA,))
    if ok:
        assert p.chat(GEMMA, MSGS, 100).text == "Merhaba."
    else:
        with pytest.raises(ProviderError) as e:
            p.chat(GEMMA, MSGS, 100)
        assert e.value.kind == "model_mismatch"
    assert json.loads(seen[0].content)["model"] == "gemma-4-31b"  # kimlik olduğu gibi gönderilir


@pytest.mark.parametrize("requested,served,ok", [
    # Doğrulanmış eşleşme (canlı tanılama: gemma-4-31b → google/gemma-4-31b)
    (GEMMA, "google/gemma-4-31b", True),
    (GEMMA, "Google/Gemma-4-31B", True),
    # Aynı önekle farklı model veya sürüm eki: kabul edilmez
    (GEMMA, "google/gemma-4-27b", False),
    (GEMMA, "google/gemma-3-31b", False),
    (GEMMA, "google/gemma-4-31b-it", False),
    (GEMMA, "google/gemma-4-31", False),
    (GEMMA, "google/", False),
    # Başka önek: kabul edilmez (genel önek kaldırma yok)
    (GEMMA, "meta/gemma-4-31b", False),
    (GEMMA, "google/gemma-4-31b/extra", False),
    # glm-5.3 kuralı değişmedi: önekli ad ve Gemma kabul edilmez
    ("glm-5.3", "google/glm-5.3", False),
    ("glm-5.3", "google/gemma-4-31b", False),
    ("glm-5.3", "glm-5.3", True),
    ("glm-5.3", "glm-5.3-20261001", True),
])
def test_verified_gemma_served_id_is_accepted_and_nothing_looser(requested, served, ok):
    p = _evren(_ok(_message(model=served)), models=(requested,))
    if ok:
        assert p.chat(requested, MSGS, 100).model == served
    else:
        with pytest.raises(ProviderError) as e:
            p.chat(requested, MSGS, 100)
        assert e.value.kind == "model_mismatch"


def test_model_mismatch_reports_only_sanitized_served_model_id(caplog):
    caplog.set_level(logging.DEBUG)
    served = "kotu<script>/model\n" + "x" * 100
    body = _message(f"{KEY} gizli yanıt metni", model=served)
    with pytest.raises(ProviderError) as e:
        _evren(_ok(body), models=(GEMMA,)).chat(GEMMA, MSGS, 100)
    err = e.value
    assert err.kind == "model_mismatch" and err.status == 200
    assert err.code.startswith("served:kotuscript/model") and len(err.code) <= len("served:") + 60
    blob = f"{err} {err.code} {err.upstream} {err.args} {caplog.text}"
    assert KEY not in blob and "gizli" not in blob and "<" not in err.code and "\n" not in err.code
    # Uyuşmazlık kuralı değişmedi: başka aile veya başka boyut kabul edilmez.
    for other in ("gemma-4-27b", "glm-5.3", "gemma-3-31b"):
        with pytest.raises(ProviderError) as e2:
            _evren(_ok(_message(model=other)), models=(GEMMA,)).chat(GEMMA, MSGS, 100)
        assert (e2.value.kind, e2.value.code) == ("model_mismatch", f"served:{other}")


def test_glm_503_is_unavailable_and_gemma_still_answers():
    def handler(request):
        if json.loads(request.content)["model"] == "glm-5.3":
            return httpx.Response(503, json={"type": "error", "error": {"type": "api_error", "message": "x"}})
        return httpx.Response(200, json=_message("Cevap.", model=GEMMA))
    p = _evren(handler, models=("glm-5.3", GEMMA))
    with pytest.raises(ProviderError) as e:
        p.chat("glm-5.3", MSGS, 100)
    assert (e.value.kind, e.value.status) == ("unavailable", 503)
    assert p.chat(GEMMA, MSGS, 100).text == "Cevap."


def test_registry_uses_gemma_when_configured(monkeypatch):
    from app.guide.registry import build_provider
    monkeypatch.setenv("VAKIFNAME_GUIDE_PROVIDER", "evren")
    monkeypatch.setenv("VAKIFNAME_GUIDE_FALLBACK", "none")
    monkeypatch.setenv("VAKIFNAME_GUIDE_MODEL", GEMMA)
    monkeypatch.delenv("VAKIFNAME_CONTENT_MODEL", raising=False)
    monkeypatch.delenv("VAKIFNAME_EVREN_BASE_URL", raising=False)
    p = build_provider()[0]
    assert [m["id"] for m in p.models()] == [GEMMA]


def test_service_answers_from_records_with_gemma():
    seen = []
    ask = AskService(PublicCatalogRepository(CATALOG), background=False)
    reply = _answer(("Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001]), ("Mimarı Ali Neccar'dır.", [F001]))
    svc = GuideService(ask, _evren(_ok(_message(reply, model=GEMMA), seen), models=(GEMMA,)),
                       DailyBudget(None, 100, 1_000_000), GuideSettings(text_model=GEMMA), face_screen=FakeFaceScreen())
    r = svc.ask("Ulu Cami'yi kim yaptırdı?")
    assert r["status"] == "answered" and r["removed_claims"] == 1
    assert [s["text"] for s in r["sentences"]] == ["Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır."]
    assert json.loads(seen[0].content)["model"] == GEMMA


def test_invalid_model_id_is_refused_before_any_request():
    calls = []
    with pytest.raises(ProviderError) as e:
        _evren(_ok(_message(), calls)).chat("glm-5.3; rm -rf /", MSGS, 100)
    assert e.value.kind == "bad_request" and calls == []


@pytest.mark.parametrize("response", [
    httpx.Response(200, content=b""),
    httpx.Response(200, content=b"<html>bakim</html>"),
    httpx.Response(200, json=["liste"]),
    httpx.Response(200, json={k: v for k, v in _message().items() if k != "model"}),
    httpx.Response(200, json={k: v for k, v in _message().items() if k != "content"}),
    httpx.Response(200, json=_message(blocks=[])),
    httpx.Response(200, json=_message(blocks=[{"type": "text", "text": "   "}])),
    httpx.Response(200, json=_message(blocks=[{"type": "thinking", "thinking": "iç düşünce"}])),
    httpx.Response(200, json=_message(usage={"input_tokens": "çok", "output_tokens": 1})),
])
def test_empty_or_broken_response_is_invalid(response):
    with pytest.raises(ProviderError) as e:
        _evren(lambda request: response).chat(DEFAULT_EVREN_MODEL, MSGS, 100)
    assert e.value.kind == "invalid_response"


def test_thinking_blocks_are_not_part_of_the_answer_and_refusal_is_moderation():
    blocks = [{"type": "thinking", "thinking": "gizli akıl yürütme"}, {"type": "text", "text": "Cevap."}]
    assert _evren(_ok(_message(blocks=blocks))).chat(DEFAULT_EVREN_MODEL, MSGS, 100).text == "Cevap."
    with pytest.raises(ProviderError) as e:
        _evren(_ok(_message("Yardım edemem.", stop="refusal"))).chat(DEFAULT_EVREN_MODEL, MSGS, 100)
    assert e.value.kind == "moderation"
    assert _evren(_ok(_message(stop="max_tokens"))).chat(DEFAULT_EVREN_MODEL, MSGS, 100).finish_reason == "length"


# --- JSON ------------------------------------------------------------------------------------------------------------

def test_json_mode_adds_instruction_and_returns_clean_json():
    seen = []
    fenced = '```json\n{"status": "answered", "sentences": []}\n```'
    r = _evren(_ok(_message(fenced), seen)).chat(DEFAULT_EVREN_MODEL, MSGS, 100, json_mode=True)
    assert json.loads(r.text) == {"status": "answered", "sentences": []}
    assert json.loads(seen[0].content)["system"].endswith(JSON_INSTRUCTION)
    assert "response_format" not in json.loads(seen[0].content)  # Anthropic API'sinde yok


def test_json_text_extracts_single_object_or_leaves_text():
    assert json.loads(json_text('İşte cevap: {"a": 1} umarım yardımcı olur')) == {"a": 1}
    assert json_text("cevap veremem") == "cevap veremem"
    assert json_text("[1, 2]") == "[1, 2]"  # nesne değil: servis biçim hatası olarak ele alır


# --- Yapılandırma ----------------------------------------------------------------------------------------------------

def test_base_url_must_be_https_except_loopback():
    assert check_base_url(DEFAULT_EVREN_BASE_URL + "/") == "https://evren-llmapi.ssyz.org.tr"
    assert check_base_url("http://127.0.0.1:9000") == "http://127.0.0.1:9000"
    for bad in ("http://evren-llmapi.ssyz.org.tr", "ftp://x.invalid", "https://kullanici:parola@x.invalid",
                "https://x.invalid/?a=1", "evren"):
        with pytest.raises(ValueError):
            check_base_url(bad)


def test_registry_selects_evren_with_default_model_and_keeps_openrouter_default(monkeypatch):
    from app.guide.registry import DEFAULT_MODELS, ProviderConfigError, build_provider
    for v in ("VAKIFNAME_GUIDE_MODEL", "VAKIFNAME_CONTENT_MODEL", "VAKIFNAME_EVREN_BASE_URL", "VAKIFNAME_GUIDE_FALLBACK"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.delenv("VAKIFNAME_GUIDE_PROVIDER", raising=False)
    assert build_provider()[1] == "openrouter"
    monkeypatch.setenv("VAKIFNAME_GUIDE_PROVIDER", "evren")
    monkeypatch.setenv("VAKIFNAME_GUIDE_FALLBACK", "none")
    p, name, fb = build_provider()
    assert isinstance(p, EvrenProvider) and name == "evren" and fb is None
    assert DEFAULT_MODELS["evren"] == "glm-5.3" and [m["id"] for m in p.models()] == ["glm-5.3"]
    assert p.base_url == "https://evren-llmapi.ssyz.org.tr"
    monkeypatch.setenv("VAKIFNAME_GUIDE_MODEL", "glm-5.3-ozel")
    monkeypatch.setenv("VAKIFNAME_CONTENT_MODEL", "glm-5.3")
    assert [m["id"] for m in build_provider()[0].models()] == ["glm-5.3-ozel", "glm-5.3"]
    monkeypatch.setenv("VAKIFNAME_EVREN_BASE_URL", "http://evren-llmapi.ssyz.org.tr")
    with pytest.raises(ProviderConfigError, match="https"):
        build_provider()


def test_app_uses_glm_by_default_when_evren_selected(monkeypatch, tmp_path):
    from app.main import create_app
    monkeypatch.setenv("VAKIFNAME_GUIDE_PROVIDER", "evren")
    monkeypatch.setenv("VAKIFNAME_GUIDE_FALLBACK", "none")
    monkeypatch.delenv("VAKIFNAME_GUIDE_MODEL", raising=False)
    monkeypatch.setenv("VAKIFNAME_EVREN_KEY_FILE", str(tmp_path / "yok"))
    monkeypatch.setenv("VAKIFNAME_GUIDE_BUDGET_DB", ":memory:")
    monkeypatch.setenv("VAKIFNAME_GUIDE_LEXICON", "off")
    app = create_app(public_catalog_file=CATALOG, demo_api=False, ask_background=False)
    assert app.state.guide.settings.text_model == "glm-5.3"
    assert app.state.guide.provider.available() == (False, KeyStatus.MISSING)


# --- RAG / kaynak koruması (servis + Evren sağlayıcısı) --------------------------------------------------------------

def _answer(*sentences, status="answered", missing=""):
    return json.dumps({"status": status, "sentences": [{"text": t, "sources": s} for t, s in sentences],
                       "missing": missing}, ensure_ascii=False)


def _service(model_text, seen=None):
    ask = AskService(PublicCatalogRepository(CATALOG), background=False)
    provider = _evren(_ok(_message(model_text), seen))
    settings = GuideSettings(text_model=DEFAULT_EVREN_MODEL)
    return GuideService(ask, provider, DailyBudget(None, 100, 1_000_000), settings, face_screen=FakeFaceScreen()), ask


def test_only_approved_records_are_sent_and_unsupported_or_foreign_claims_are_removed():
    seen = []
    model_text = _answer(("Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001]),
                         ("Mimarı Ali Neccar'dır.", [F001]),                       # kayıtta yok: çıkarılmalı
                         ("Yapı 1399–1400'de tamamlanmıştır.", ["BUR-9999-F001"]))  # verilmemiş kimlik: kabul edilmez
    svc, ask = _service(model_text, seen)
    r = svc.ask("Ulu Cami'yi kim yaptırdı ve ne zaman bitti?")
    assert r["mode"] == "generative" and r["status"] == "answered"
    assert [s["text"] for s in r["sentences"]] == ["Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır."]
    assert r["removed_claims"] == 2 and [f["fact_id"] for f in r["facts"]] == [F001]
    # Modele giden kayıtların hepsi yayın kararı olan genel katalogdan; sistem istemi ayrı alanda.
    body = json.loads(seen[0].content)
    sent_ids = set(re.findall(r"BUR-\d{4}-F\d{3}", json.dumps(body, ensure_ascii=False)))
    assert F001 in sent_ids and sent_ids <= {d.fact_id for d in ask.engine().corpus.docs}
    assert body["system"] and all(m["role"] in ("user", "assistant") for m in body["messages"])


def test_no_source_means_no_invented_history():
    svc, _ = _service(_answer(("Ulu Cami 1200 yılında yapılmıştır.", [F001])))
    r = svc.ask("Ulu Cami ne zaman yapıldı?")
    assert r["status"] == "insufficient_evidence" and r["sentences"] == [] and r["facts"] == []
    svc, _ = _service(_answer(status="insufficient_evidence", missing="Kayıtlarda kapı sayısı geçmiyor."))
    r = svc.ask("Ulu Cami'nin kaç kapısı var?", "BUR-0001")
    assert r["status"] == "insufficient_evidence" and r["sentences"] == []


def test_provider_failure_falls_back_to_source_search_and_logs_no_key_or_question(caplog):
    caplog.set_level(logging.DEBUG)
    ask = AskService(PublicCatalogRepository(CATALOG), background=False)
    body = {"type": "error", "error": {"type": "rate_limit_error", "message": f"{KEY} Ulu Cami'de kaç kubbe var?"}}
    svc = GuideService(ask, _evren(_ok(body, status=429)), DailyBudget(None, 100, 1_000_000),
                       GuideSettings(text_model=DEFAULT_EVREN_MODEL), face_screen=FakeFaceScreen())
    r = svc.ask("Ulu Cami'de kaç kubbe var?")
    assert r["mode"] == "fallback_search" and r["fallback_reason"] == "rate_limited"
    assert r["search"]["status"] == "answered"
    assert KEY not in caplog.text and "kaç kubbe" not in caplog.text


def test_successful_call_logs_no_key_or_content(caplog):
    caplog.set_level(logging.DEBUG)
    svc, _ = _service(_answer(("Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır.", [F001])))
    svc.ask("Ulu Cami'yi kim yaptırdı?")
    assert KEY not in caplog.text and "Yıldırım" not in caplog.text and "kim yaptırdı" not in caplog.text


# --- Yanıt yapısı tanılaması (yalnızca meta veri) --------------------------------------------------------------------

_SAFE_NAME = re.compile(r"[^A-Za-z0-9_.:/-]")


def _name(v) -> str:
    """Alan adı / tür / durum gibi kısa tanımlayıcılar: temizlenmiş ve kısaltılmış. Serbest metin değildir."""
    return _SAFE_NAME.sub("", str(v))[:40]


def response_shape(raw: bytes) -> dict:
    """Ham yanıt gövdesinin YALNIZCA yapısı: üst alan adları, `type`, `stop_reason`, `usage` sayıları, `content` blok
    türleri ve blok alan adları, metin/düşünme bloklarının sayısı ve UZUNLUKLARI. Hiçbir metin değeri döndürülmez."""
    try:
        body = json.loads(raw) if raw.strip() else None
    except ValueError:
        return {"json": False, "bytes": len(raw)}
    if not isinstance(body, dict):
        return {"json": True, "top_type": type(body).__name__}
    content = body.get("content")
    blocks = [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []
    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}

    def length(b: dict, key: str) -> int:
        v = b.get(key)
        return len(v) if isinstance(v, str) else -1  # -1: alan yok veya metin değil

    return {
        "top_keys": sorted(_name(k) for k in body),
        "type": _name(body.get("type")) if isinstance(body.get("type"), str) else None,
        "stop_reason": _name(body.get("stop_reason")) if isinstance(body.get("stop_reason"), str) else body.get("stop_reason"),
        "usage": {_name(k): v for k, v in usage.items() if isinstance(v, (int, float)) and not isinstance(v, bool)},
        "content_type": type(content).__name__,
        "block_types": [_name(b.get("type")) for b in blocks],
        "block_keys": sorted({_name(k) for b in blocks for k in b}),
        "text_blocks": sum(1 for b in blocks if b.get("type") == "text"),
        "text_lengths": [length(b, "text") for b in blocks if b.get("type") == "text"],
        "text_stripped_lengths": [len(b["text"].strip()) for b in blocks
                                  if b.get("type") == "text" and isinstance(b.get("text"), str)],
        "thinking_lengths": [length(b, "thinking") for b in blocks if b.get("type") in ("thinking", "redacted_thinking")],
    }


class RecordingTransport(httpx.BaseTransport):
    """Gerçek aktarımı sarar; son yanıtın durumunu ve gövdesini YALNIZCA bellekte tutar (diske/loga yazmaz)."""

    def __init__(self, inner: httpx.BaseTransport):
        self.inner, self.status, self.raw = inner, None, b""

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        r = self.inner.handle_request(request)
        try:
            raw = r.read()  # çözülmüş (gzip açılmış) gövde
        finally:
            r.close()
        self.status, self.raw = r.status_code, raw
        headers = [(k, v) for k, v in r.headers.items() if k.lower() not in ("content-encoding", "content-length",
                                                                               "transfer-encoding")]
        return httpx.Response(r.status_code, headers=headers, content=raw, request=request)


def test_response_shape_reports_metadata_only_for_thinking_only_answer():
    secret_text = "GİZLİ-DÜŞÜNCE gizli cevap"
    body = _message(model="google/gemma-4-31b", stop="max_tokens",
                    blocks=[{"type": "thinking", "thinking": secret_text, "signature": "imza-xyz"}],
                    usage={"input_tokens": 21, "output_tokens": 20})
    raw = json.dumps(body, ensure_ascii=False).encode()
    shape = response_shape(raw)
    assert shape == {
        "top_keys": ["content", "id", "model", "role", "stop_reason", "type", "usage"], "type": "message",
        "stop_reason": "max_tokens", "usage": {"input_tokens": 21, "output_tokens": 20}, "content_type": "list",
        "block_types": ["thinking"], "block_keys": ["signature", "thinking", "type"], "text_blocks": 0,
        "text_lengths": [], "text_stripped_lengths": [], "thinking_lengths": [len(secret_text)],
    }
    dumped = json.dumps(shape, ensure_ascii=False)
    assert "GİZLİ" not in dumped and "gizli" not in dumped and "imza" not in dumped and KEY not in dumped
    # Mevcut davranış korunur: yalnızca düşünme bloğu varsa cevap boş sayılır.
    with pytest.raises(ProviderError) as e:
        _evren(_ok(body), models=(GEMMA,)).chat(GEMMA, MSGS, 20)
    assert (e.value.kind, e.value.code) == ("invalid_response", "empty")


@pytest.mark.parametrize("blocks,expect", [
    ([{"type": "text", "text": ""}], {"text_blocks": 1, "text_lengths": [0], "text_stripped_lengths": [0]}),
    ([{"type": "text", "text": "  \n "}], {"text_blocks": 1, "text_lengths": [4], "text_stripped_lengths": [0]}),
    ([{"type": "text", "content": "başka alanda metin"}], {"text_blocks": 1, "text_lengths": [-1], "block_keys": ["content", "type"]}),
    ([{"type": "output_text", "text": "farklı tür"}], {"text_blocks": 0, "block_types": ["output_text"]}),
])
def test_response_shape_distinguishes_empty_answer_causes_without_text(blocks, expect):
    body = _message(model="google/gemma-4-31b", blocks=blocks)
    shape = response_shape(json.dumps(body, ensure_ascii=False).encode())
    for k, v in expect.items():
        assert shape[k] == v
    dumped = json.dumps(shape, ensure_ascii=False)
    assert "başka alanda" not in dumped and "farklı tür" not in dumped
    with pytest.raises(ProviderError) as e:  # üretim davranışı değişmedi: hepsi boş cevap
        _evren(_ok(body), models=(GEMMA,)).chat(GEMMA, MSGS, 100)
    assert (e.value.kind, e.value.code) == ("invalid_response", "empty")


def test_response_shape_handles_non_json_and_recording_transport_keeps_body_in_memory():
    assert response_shape(b"<html>x</html>") == {"json": False, "bytes": 14}
    assert response_shape(b"[1]") == {"json": True, "top_type": "list"}
    rec = RecordingTransport(httpx.MockTransport(_ok(_message(model="google/gemma-4-31b"))))
    r = EvrenProvider("https://evren.invalid", models=(GEMMA,), key_loader=lambda: (KEY, KeyStatus.OK),
                      transport=rec).chat(GEMMA, MSGS, 100)
    assert r.text == "Merhaba." and rec.status == 200 and response_shape(rec.raw)["text_lengths"] == [8]


# --- Gerçek API (yalnızca açıkça istenirse) --------------------------------------------------------------------------

@pytest.mark.skipif(os.environ.get("VAKIFNAME_EVREN_LIVE_TEST") != "1",
                    reason="Gerçek Evren API testi: VAKIFNAME_EVREN_LIVE_TEST=1 ve anahtar dosyası gerekir.")
def test_live_evren_api_answers_with_requested_model():
    # Model: VAKIFNAME_EVREN_LIVE_MODEL, yoksa VAKIFNAME_GUIDE_MODEL, yoksa varsayılan (glm-5.3).
    # Token sınırı: VAKIFNAME_EVREN_LIVE_MAX_TOKENS (varsayılan 256; düşünen modellerde 20 token düşünmeye gidebilir).
    model = (os.environ.get("VAKIFNAME_EVREN_LIVE_MODEL") or os.environ.get("VAKIFNAME_GUIDE_MODEL") or "").strip() \
        or DEFAULT_EVREN_MODEL
    max_tokens = int(os.environ.get("VAKIFNAME_EVREN_LIVE_MAX_TOKENS") or 256)
    rec = RecordingTransport(httpx.HTTPTransport())
    p = EvrenProvider(os.environ.get("VAKIFNAME_EVREN_BASE_URL") or DEFAULT_EVREN_BASE_URL, models=(model,), transport=rec)
    ok, status = p.available()
    assert ok, f"Evren anahtarı kullanılamıyor: {status}"
    # Yalnızca meta veri yazılır: tür, HTTP durumu, tanılama kodu ve yanıtın yapısı. Anahtar, istek ve yanıt metni yazılmaz.
    try:
        r = p.chat(model, [{"role": "system", "content": "Kısa cevap ver."},
                           {"role": "user", "content": "Yalnızca 'tamam' yaz."}], max_tokens=max_tokens, timeout_s=60)
    except ProviderError as e:
        shape = json.dumps(response_shape(rec.raw), ensure_ascii=False) if rec.status is not None else "-"
        pytest.fail(f"Evren hatası: kind={e.kind} http={e.status} code={e.code or '-'} istenen={model} "
                    f"max_tokens={max_tokens} yapı={shape}")
    print(f"\nEvren tanılama: istenen={model} dönen={r.model} max_tokens={max_tokens} "
          f"yapı={json.dumps(response_shape(rec.raw), ensure_ascii=False)}")
    assert r.text.strip() and r.prompt_tokens > 0
