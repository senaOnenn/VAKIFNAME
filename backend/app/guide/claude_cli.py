"""Claude Code (`claude -p`) sağlayıcısı: API anahtarı yerine yerel `claude` oturumunun (abonelik girişi) kullanımı.

Çağrılar API faturasına değil, `claude` komutunda oturum açmış hesabın abonelik kullanım limitine yazılır. Bu yüzden
alt sürece verilen ortamdan `ANTHROPIC_*` (API anahtarı/token) ve üçüncü taraf bulut değişkenleri çıkarılır; böylece CLI
yanlışlıkla API anahtarına düşemez. İstek ve yanıt metinleri loglanmaz; hata nesneleri yalnızca tür taşır.

Güvenlik: metin çağrılarında bütün araçlar kapalıdır (`--tools ""`). Fotoğraflı çağrıda yalnızca `Read` aracı açılır ve
çalışma dizini, görselin yazıldığı geçici ve özel dizindir. Kullanıcı/proje ayarları (hook, CLAUDE.md, bellek) yüklenmez.
"""

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Optional

from .provider import ChatResult, ProviderError
from .secret import KeyStatus

AUTH_TTL_S = 30.0
DEFAULT_CLAUDE_MODEL = "sonnet"  # takma ad (haiku | sonnet | opus) veya tam model kimliği
_DATA_URL = re.compile(r"^data:image/(png|jpeg|jpg|webp);base64,(.+)$", re.S)
_STRIP_ENV = re.compile(r"^(ANTHROPIC_|CLAUDE_CODE_USE_|AWS_BEARER_TOKEN_BEDROCK|CLOUD_ML_)")
_QUOTA_HINTS = ("usage limit", "limit reached", "rate limit", "quota", "overloaded")
_AUTH_HINTS = ("/login", "not logged in", "invalid api key", "authentication", "oauth")


def _clean_env() -> dict:
    return {k: v for k, v in os.environ.items() if not _STRIP_ENV.match(k)}


class ClaudeCliProvider:
    name = "claude-cli"

    def __init__(self, binary: Optional[str] = None, effort: str = "low", runner=subprocess.run):
        self.binary = binary if binary is not None else (os.environ.get("VAKIFNAME_CLAUDE_BIN") or shutil.which("claude"))
        self.effort = effort
        self._run = runner
        self._lock = threading.Lock()
        self._auth_cache: Optional[tuple[float, dict]] = None

    def _auth(self) -> dict:
        """`claude auth status` çıktısı (önbellekli; token harcamaz). Okunamazsa boş sözlük."""
        with self._lock:
            if self._auth_cache and time.monotonic() - self._auth_cache[0] < AUTH_TTL_S:
                return self._auth_cache[1]
        try:
            p = self._run([self.binary, "auth", "status"], capture_output=True, text=True, timeout=15, env=_clean_env())
            info = json.loads(p.stdout) if p.stdout.strip() else {}
        except (subprocess.SubprocessError, OSError, ValueError):
            info = {}
        info = info if isinstance(info, dict) else {}
        with self._lock:
            self._auth_cache = (time.monotonic(), info)
        return info

    def available(self) -> tuple[bool, str]:
        """Dosyanın varlığı yetmez: oturum açık ve giriş yöntemi claude.ai (abonelik) olmalıdır. Konsol/API girişi
        reddedilir; çünkü o yol API faturasına yazılır."""
        if not self.binary:
            return False, KeyStatus.MISSING
        info = self._auth()
        if not info.get("loggedIn"):
            return False, "not_logged_in"
        if info.get("authMethod") != "claude.ai":
            return False, "not_subscription"
        return True, KeyStatus.OK

    def describe(self) -> dict:
        info = self._auth()
        return {"account": info.get("email"), "plan": info.get("subscriptionType"), "auth_method": info.get("authMethod")}

    def models(self) -> list[dict]:
        # GuideService model bilgisini buradan sorar: görsel ve JSON desteği Claude modellerinde vardır.
        return [{"id": m, "architecture": {"input_modalities": ["text", "image"]}, "supported_parameters": ["response_format"]}
                for m in ("haiku", "sonnet", "opus")]

    @staticmethod
    def _flatten(messages: list[dict], workdir: str) -> tuple[str, str, int]:
        """OpenAI biçimli mesajları (sistem istemi, kullanıcı metni) çiftine çevirir; görselleri dosyaya yazar."""
        system, parts, images = [], [], 0
        for m in messages:
            content = m.get("content")
            if m.get("role") == "system":
                system.append(str(content))
                continue
            if isinstance(content, str):
                parts.append(content)
                continue
            for p in content or []:
                if p.get("type") == "text":
                    parts.append(str(p.get("text", "")))
                elif p.get("type") == "image_url":
                    hit = _DATA_URL.match(str((p.get("image_url") or {}).get("url", "")))
                    if not hit:
                        raise ProviderError("bad_request", code="image_format")
                    images += 1
                    ext = "jpg" if hit.group(1) in ("jpeg", "jpg") else hit.group(1)
                    path = os.path.join(workdir, f"image{images}.{ext}")
                    with open(path, "wb") as f:
                        f.write(base64.b64decode(hit.group(2)))
                    parts.append(f"[Fotoğraf: önce Read aracıyla '{os.path.basename(path)}' dosyasını oku.]")
        return "\n\n".join(system), "\n\n".join(parts), images

    def chat(self, model: str, messages: list[dict], max_tokens: int, temperature: float = 0.2,
             json_mode: bool = False, timeout_s: float = 60.0) -> ChatResult:
        if not self.binary:
            raise ProviderError("no_key")
        t0 = time.perf_counter()
        # `claude` bu geçici dizinde çalışır: proje dosyası, git ve bellek yoktur; fotoğraf dosyaları da buraya yazılır.
        with tempfile.TemporaryDirectory(prefix="vakifname-claude-") as workdir:
            os.chmod(workdir, 0o700)
            system, prompt, images = self._flatten(messages, workdir)
            if json_mode:
                prompt += "\n\nYalnızca geçerli tek bir JSON nesnesi döndür; önüne veya arkasına metin ekleme."
            cmd = [self.binary, "-p", "--output-format", "json", "--model", model, "--effort", self.effort,
                   "--no-session-persistence", "--setting-sources", "", "--disable-slash-commands",
                   "--strict-mcp-config", "--system-prompt", system or "Kısa ve doğru cevap ver."]
            cmd += ["--tools", "Read", "--allowedTools", "Read"] if images else ["--tools", ""]
            try:
                p = self._run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout_s, cwd=workdir,
                              env=_clean_env())
            except subprocess.TimeoutExpired as e:
                raise ProviderError("timeout") from e
            except OSError as e:
                raise ProviderError("unavailable", code=f"spawn:{type(e).__name__}") from e
        try:
            body = json.loads(p.stdout) if p.stdout.strip() else {}
        except ValueError:
            body = {}
        text = body.get("result") if isinstance(body.get("result"), str) else ""
        if p.returncode != 0 or body.get("is_error"):
            low = (text or p.stderr or "").lower()
            kind = ("quota" if any(h in low for h in _QUOTA_HINTS) else "auth" if any(h in low for h in _AUTH_HINTS)
                    else "unavailable")
            raise ProviderError(kind, code=f"cli_exit:{p.returncode}")
        if not text.strip():
            raise ProviderError("invalid_response")
        usage = body.get("usage") or {}
        prompt_tokens = int(usage.get("input_tokens") or 0) + int(usage.get("cache_creation_input_tokens") or 0) \
            + int(usage.get("cache_read_input_tokens") or 0)
        served = next(iter(body.get("modelUsage") or {}), model)
        return ChatResult(text=text, model=model, prompt_tokens=prompt_tokens,
                          completion_tokens=int(usage.get("output_tokens") or 0),
                          latency_ms=int((time.perf_counter() - t0) * 1000), request_id=body.get("session_id"),
                          finish_reason="stop" if body.get("stop_reason") == "end_turn" else body.get("stop_reason"),
                          cost=0.0,  # abonelik kullanımı: API ücreti yoktur (CLI'nin `total_cost_usd`si liste fiyatı tahminidir)
                          upstream=served[:40])
