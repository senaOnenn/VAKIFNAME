"""Rehber sağlayıcısının tek seçim noktası: `VAKIFNAME_GUIDE_PROVIDER` (+ isteğe bağlı `VAKIFNAME_GUIDE_FALLBACK`).

Kurallar:
- Sağlayıcı env'de açıkça yazılır; sessiz geçiş yoktur. Giriş/anahtar yoksa rehber kapanır ve kaynaklı aramaya düşülür.
- Yedek yalnızca `VAKIFNAME_GUIDE_FALLBACK` bilinçli olarak yazılırsa kullanılır (varsayılan `none`) ve modeli ayrıca
  `VAKIFNAME_GUIDE_FALLBACK_MODEL` ile verilir; sağlayıcılar birbirinin model adını tanımaz.
- Bilinmeyen veya henüz yazılmamış bir ad sessizce varsayılana düşmez; açılışta `ProviderConfigError` verir.
"""

import logging
import os
from typing import Callable, Optional

from .claude_cli import DEFAULT_CLAUDE_MODEL, ClaudeCliProvider
from .provider import DEFAULT_BASE_URL, ChatProvider, ChatResult, OpenRouterProvider, ProviderError

logger = logging.getLogger("vakifname.guide")

DEFAULT_PROVIDER = "openrouter"
# Çalışan sağlayıcılar. Yenisini eklemek: `ChatProvider` arayüzünü uygulayan sınıf + buraya bir satır + .env.example notu.
PROVIDERS: dict[str, Callable[[], ChatProvider]] = {
    "claude-cli": lambda: ClaudeCliProvider(effort=os.environ.get("VAKIFNAME_CLAUDE_EFFORT", "low")),
    "openrouter": lambda: OpenRouterProvider(os.environ.get("VAKIFNAME_GUIDE_BASE_URL", DEFAULT_BASE_URL),
                                             allow_paid=os.environ.get("VAKIFNAME_GUIDE_ALLOW_PAID_MODEL") == "1",
                                             reasoning=os.environ.get("VAKIFNAME_GUIDE_REASONING", "off")),
}
# Planlanan ama kodu henüz yazılmamış adlar: seçilirse açık hata verilir.
PLANNED = {"claude-api", "codex", "gemini-cli"}
DEFAULT_MODELS = {"claude-cli": DEFAULT_CLAUDE_MODEL}  # model env'de verilmediyse sağlayıcıya göre varsayılan
# Yedeğe geçişi tetikleyen hata türleri: yapılandırma/kota sorunları. İçerik reddi (moderation) ve kötü istek geçmez.
FALLBACK_KINDS = {"no_key", "auth", "not_logged_in", "not_subscription", "quota", "unavailable", "timeout"}


class ProviderConfigError(RuntimeError):
    pass


def _name(var: str, default: str) -> str:
    return os.environ.get(var, default).strip().lower() or default


def _make(name: str, var: str) -> ChatProvider:
    if name in PLANNED:
        raise ProviderConfigError(f"{var}={name}: bu sağlayıcı henüz yazılmadı. Çalışanlar: {', '.join(sorted(PROVIDERS))}")
    if name not in PROVIDERS:
        raise ProviderConfigError(f"{var}={name}: bilinmeyen sağlayıcı. Geçerli değerler: {', '.join(sorted(PROVIDERS))}")
    return PROVIDERS[name]()


class FallbackProvider:
    """Birincil sağlayıcı kullanılamıyorsa (giriş/anahtar yok, kota, ulaşılamıyor) yalnızca yazılı yedeğe geçer."""

    def __init__(self, primary: ChatProvider, fallback: ChatProvider, fallback_model: str):
        self.primary, self.fallback, self.fallback_model = primary, fallback, fallback_model
        self.name = f"{primary.name}+{fallback.name}"

    def available(self) -> tuple[bool, str]:
        ok, status = self.primary.available()
        return (True, status) if ok else self.fallback.available()

    def describe(self) -> dict:
        d = getattr(self.primary, "describe", lambda: {})()
        return {**d, "fallback": self.fallback.name, "fallback_model": self.fallback_model}

    def models(self) -> list[dict]:
        out = list(self.primary.models())
        try:
            out += self.fallback.models()
        except ProviderError:
            pass
        return out

    def chat(self, model: str, messages: list[dict], max_tokens: int, temperature: float = 0.2, json_mode: bool = False,
             timeout_s: float = 60.0) -> ChatResult:
        if self.primary.available()[0]:
            try:
                return self.primary.chat(model, messages, max_tokens, temperature, json_mode, timeout_s)
            except ProviderError as e:
                if e.kind not in FALLBACK_KINDS:
                    raise
                logger.warning("guide provider fallback primary=%s kind=%s -> %s", self.primary.name, e.kind, self.fallback.name)
        return self.fallback.chat(self.fallback_model, messages, max_tokens, temperature, json_mode, timeout_s)


def build_provider() -> tuple[ChatProvider, str, Optional[str]]:
    """(sağlayıcı, birincil sağlayıcı adı, yedek model). Geçersiz yapılandırmada ProviderConfigError."""
    name = _name("VAKIFNAME_GUIDE_PROVIDER", DEFAULT_PROVIDER)
    provider = _make(name, "VAKIFNAME_GUIDE_PROVIDER")
    fb_name = _name("VAKIFNAME_GUIDE_FALLBACK", "none")
    if fb_name == "none":
        return provider, name, None
    if fb_name == name:
        raise ProviderConfigError("VAKIFNAME_GUIDE_FALLBACK, VAKIFNAME_GUIDE_PROVIDER ile aynı olamaz.")
    fb_model = os.environ.get("VAKIFNAME_GUIDE_FALLBACK_MODEL", "").strip()
    if not fb_model:
        raise ProviderConfigError("VAKIFNAME_GUIDE_FALLBACK için VAKIFNAME_GUIDE_FALLBACK_MODEL de yazılmalı.")
    return FallbackProvider(provider, _make(fb_name, "VAKIFNAME_GUIDE_FALLBACK"), fb_model), name, fb_model


def log_selection(provider: ChatProvider, model: str) -> None:
    """Açılışta hangi sağlayıcı ve hesabın kullanılacağını tek satırda yazar (token harcamaz)."""
    ok, status = provider.available()
    d = getattr(provider, "describe", lambda: {})() if ok else {}
    acct = ", ".join(f"{k}={v}" for k, v in d.items() if v) or "-"
    logger.info("Rehber sağlayıcısı: %s model=%s hazır=%s%s hesap: %s", provider.name, model, ok,
                "" if ok else f" ({status})", acct)
