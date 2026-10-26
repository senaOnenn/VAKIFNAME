"""ClaudeCliProvider: alt süreç sahte `runner` ile; gerçek `claude` çağrılmaz."""
import base64
import json
import subprocess

import pytest

from app.guide.claude_cli import ClaudeCliProvider
from app.guide.provider import ProviderError


def _proc(result="Bursa", code=0, is_error=False, stderr=""):
    out = json.dumps({"result": result, "is_error": is_error, "stop_reason": "end_turn", "session_id": "s1",
                      "usage": {"input_tokens": 2, "cache_creation_input_tokens": 10, "output_tokens": 5},
                      "modelUsage": {"claude-sonnet-5-5": {}}})
    return subprocess.CompletedProcess([], code, stdout=out, stderr=stderr)


def _provider(proc, seen=None):
    def runner(cmd, **kw):
        if seen is not None:
            seen.update(cmd=cmd, **kw)
        return proc
    return ClaudeCliProvider(binary="/bin/claude", runner=runner)


MSGS = [{"role": "system", "content": "Sistem"}, {"role": "user", "content": "Soru"}]


def test_text_call_disables_tools_and_strips_api_keys(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-gizli")
    monkeypatch.setenv("CLAUDE_CODE_USE_BEDROCK", "1")
    seen = {}
    r = _provider(_proc(), seen).chat("sonnet", MSGS, 100)
    assert r.text == "Bursa" and r.cost == 0.0 and r.prompt_tokens == 12 and r.completion_tokens == 5
    assert seen["cmd"][seen["cmd"].index("--tools") + 1] == ""
    assert "ANTHROPIC_API_KEY" not in seen["env"] and "CLAUDE_CODE_USE_BEDROCK" not in seen["env"]
    assert seen["input"] == "Soru" and seen["cmd"][seen["cmd"].index("--system-prompt") + 1] == "Sistem"


def test_image_call_enables_only_read_in_private_dir():
    png = "data:image/png;base64," + base64.b64encode(b"\x89PNG").decode()
    msgs = [{"role": "user", "content": [{"type": "text", "text": "Bu ne?"}, {"type": "image_url", "image_url": {"url": png}}]}]
    seen = {}
    _provider(_proc(), seen).chat("sonnet", msgs, 100)
    assert seen["cmd"][seen["cmd"].index("--tools") + 1] == "Read" and "image1.png" in seen["input"]


@pytest.mark.parametrize("result,kind", [("Claude usage limit reached", "quota"), ("Please run /login", "auth"),
                                         ("boom", "unavailable")])
def test_cli_errors_map_to_provider_error_kinds(result, kind):
    with pytest.raises(ProviderError) as e:
        _provider(_proc(result=result, code=1, is_error=True)).chat("sonnet", MSGS, 100)
    assert e.value.kind == kind


def test_timeout_and_missing_binary():
    def boom(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 1)
    with pytest.raises(ProviderError) as e:
        ClaudeCliProvider(binary="/bin/claude", runner=boom).chat("sonnet", MSGS, 100)
    assert e.value.kind == "timeout"
    assert ClaudeCliProvider(binary="").available()[0] is False


# --- Giriş kontrolü ve sağlayıcı kaydı ---------------------------------------------------------------------------------
def _auth_provider(payload):
    def runner(cmd, **kw):
        assert cmd[1:3] == ["auth", "status"]
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(payload), stderr="")
    return ClaudeCliProvider(binary="/bin/claude", runner=runner)


def test_available_requires_subscription_login():
    ok = _auth_provider({"loggedIn": True, "authMethod": "claude.ai", "email": "a@b.c", "subscriptionType": "max"})
    assert ok.available() == (True, "ok") and ok.describe()["account"] == "a@b.c"
    assert _auth_provider({"loggedIn": False}).available() == (False, "not_logged_in")
    assert _auth_provider({"loggedIn": True, "authMethod": "console"}).available() == (False, "not_subscription")


def test_registry_rejects_unknown_and_planned_names(monkeypatch):
    from app.guide.registry import ProviderConfigError, build_provider
    monkeypatch.setenv("VAKIFNAME_GUIDE_PROVIDER", "ssvdgk")
    with pytest.raises(ProviderConfigError, match="bilinmeyen"):
        build_provider()
    monkeypatch.setenv("VAKIFNAME_GUIDE_PROVIDER", "codex")
    with pytest.raises(ProviderConfigError, match="henüz yazılmadı"):
        build_provider()


def test_registry_default_and_fallback_rules(monkeypatch):
    from app.guide.registry import FallbackProvider, ProviderConfigError, build_provider
    monkeypatch.delenv("VAKIFNAME_GUIDE_PROVIDER", raising=False)
    monkeypatch.delenv("VAKIFNAME_GUIDE_FALLBACK", raising=False)
    p, name, fb = build_provider()
    assert name == "openrouter" and fb is None and p.name == "openrouter"
    monkeypatch.setenv("VAKIFNAME_GUIDE_PROVIDER", "claude-cli")
    monkeypatch.setenv("VAKIFNAME_GUIDE_FALLBACK", "openrouter")
    with pytest.raises(ProviderConfigError, match="FALLBACK_MODEL"):
        build_provider()
    monkeypatch.setenv("VAKIFNAME_GUIDE_FALLBACK_MODEL", "x:free")
    assert isinstance(build_provider()[0], FallbackProvider)
    monkeypatch.setenv("VAKIFNAME_GUIDE_FALLBACK", "claude-cli")
    with pytest.raises(ProviderConfigError, match="aynı"):
        build_provider()


def test_fallback_switches_only_on_listed_kinds():
    from app.guide.provider import ChatResult, MockProvider
    from app.guide.registry import FallbackProvider
    ok = lambda m, msgs: "yedek"
    fb = MockProvider(ok)
    res = ChatResult(text="x", model="m", prompt_tokens=1, completion_tokens=1, latency_ms=1)

    class Prim:
        name = "prim"
        def __init__(self, err): self.err = err
        def available(self): return True, "ok"
        def models(self): return []
        def chat(self, *a, **k): raise self.err
    p = FallbackProvider(Prim(ProviderError("quota")), fb, "yedek-model")
    assert p.chat("a", MSGS, 10).text == "yedek" and fb.calls[-1]["model"] == "yedek-model"
    with pytest.raises(ProviderError):  # içerik reddi yedeğe geçmez
        FallbackProvider(Prim(ProviderError("moderation")), fb, "y").chat("a", MSGS, 10)
