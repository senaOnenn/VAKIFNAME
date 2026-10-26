"""OpenRouter (OpenAI uyumlu) sohbet sağlayıcısı ve testler için sahte sağlayıcı.

Sağlayıcıya özgü her şey bu dosyadadır. İstek ve yanıt gövdeleri loglanmaz; hata nesneleri yalnızca hata türünü ve HTTP
durumunu taşır (sağlayıcı mesajı anahtarı yansıtsa bile dışarı çıkmaz).

Ücret güvenliği: varsayılan olarak yalnızca `:free` ile biten model kimlikleri çağrılır (`allow_paid=False`); istekte
`models` (model yedekleme) listesi gönderilmez, yani OpenRouter başka bir modele geçmez. Yanıtta ücret (`usage.cost` > 0)
veya istenenden farklı bir model görülürse cevap kullanılmaz ve hata döner. 429 hatasında yeniden deneme yapılmaz.

Zaman aşımı: `timeout_s` bağlantı dahil bütün yanıt için kesin üst sınırdır. Yanıt akış olarak okunur ve her parçada
süre denetlenir; sağlayıcı bağlantıyı boşluk karakterleriyle açık tutsa bile çağrı süre dolunca `timeout` hatasıyla
kesilir (OpenRouter uzun süren isteklerde bağlantıyı böyle canlı tutabilir; tek okuma zaman aşımı bunu yakalamaz).
"""

import json
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

import httpx

from .secret import KeyStatus, load_key

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "nvidia/nemotron-3.5-super-vl:free"
APP_TITLE = "VAKIFNAME"
MODELS_TTL_S = 3600


class ProviderError(RuntimeError):
    """`kind`: no_key | auth | quota | rate_limited | moderation | bad_request | unavailable | timeout |
    invalid_response | paid_model_blocked | paid_usage_detected | model_mismatch."""

    def __init__(self, kind: str, status: Optional[int] = None, retry_after: Optional[int] = None,
                 code: str = "", upstream: str = ""):
        super().__init__(f"{kind}" + (f" (HTTP {status})" if status else ""))
        self.kind, self.status, self.retry_after = kind, status, retry_after
        # Tanılama için yalnızca kısa, içeriksiz alanlar: OpenRouter hata kodu ve yanıtı veren alt sağlayıcının adı.
        # Hata mesajı (anahtarı veya istemi yansıtabilir) hiçbir zaman tutulmaz.
        self.code, self.upstream = code, upstream


def _diag(body: dict) -> dict:
    err = (body or {}).get("error") if isinstance(body, dict) else None
    if not isinstance(err, dict):
        return {}
    meta = err.get("metadata") if isinstance(err.get("metadata"), dict) else {}
    clean = lambda v: re.sub(r"[^A-Za-z0-9_.:/ -]", "", str(v or ""))[:40]
    return {"code": clean(err.get("code")), "upstream": clean(meta.get("provider_name"))}


@dataclass
class ChatResult:
    text: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int
    request_id: Optional[str] = None
    finish_reason: Optional[str] = None
    cost: float = 0.0
    headers: dict = field(default_factory=dict)
    upstream: str = ""  # OpenRouter yanıtındaki `provider` (ör. "Nvidia")


class ChatProvider(Protocol):
    name: str

    def available(self) -> tuple[bool, str]: ...

    def chat(self, model: str, messages: list[dict], max_tokens: int, temperature: float = 0.2,
             json_mode: bool = False, timeout_s: float = 60.0) -> ChatResult: ...

    def models(self) -> list[dict]: ...


def is_free_model(model: str) -> bool:
    return model.endswith(":free")


def _base_id(model: str) -> str:
    return model.split(":", 1)[0]


def _error_kind(status: int, body: dict) -> str:
    err = (body or {}).get("error") or {}
    text = f"{err.get('code') or ''} {err.get('type') or ''} {err.get('message') or ''}".lower()
    if status == 401:
        return "auth"
    if status == 402 or "insufficient" in text or "credit" in text:
        return "quota"
    if status == 429:
        # OpenRouter ücretsiz modellerde günlük sınırı da 429 ile bildirir ("free-models-per-day").
        return "quota" if ("per-day" in text or "per day" in text or "daily" in text) else "rate_limited"
    if status == 403:
        return "moderation" if ("moderation" in text or "flagged" in text) else "auth"
    if status == 408:
        return "unavailable"
    if 400 <= status < 500:
        return "bad_request"
    return "unavailable"


def _retry_after(r: httpx.Response) -> Optional[int]:
    v = r.headers.get("Retry-After")
    if v and v.isdigit():
        return int(v)
    reset = r.headers.get("X-RateLimit-Reset")  # milisaniye cinsinden zaman damgası
    if reset and reset.isdigit():
        return max(1, int(int(reset) / 1000 - time.time()))
    return None


class OpenRouterProvider:
    name = "openrouter"

    def __init__(self, base_url: str = DEFAULT_BASE_URL, key_loader: Callable[[], tuple[Optional[str], str]] = load_key,
                 transport: Optional[httpx.BaseTransport] = None, allow_paid: bool = False, reasoning: str = "off"):
        self.base_url = base_url.rstrip("/")
        self._key_loader = key_loader
        self._transport = transport
        self.allow_paid = allow_paid
        self.reasoning = reasoning  # off | low | default
        self._models: Optional[list[dict]] = None
        self._models_at = 0.0
        self._lock = threading.Lock()

    def available(self) -> tuple[bool, str]:
        key, status = self._key_loader()
        return key is not None, status

    def _client(self, timeout_s: float) -> httpx.Client:
        key, status = self._key_loader()
        if key is None:
            raise ProviderError("no_key" if status == KeyStatus.MISSING else status)
        # Anahtar yalnızca bu istemcinin başlığında durur; istemci her çağrıda kapatılır.
        return httpx.Client(base_url=self.base_url, timeout=httpx.Timeout(timeout_s, connect=min(10.0, timeout_s)),
                            headers={"Authorization": f"Bearer {key}", "Accept": "application/json", "X-Title": APP_TITLE},
                            transport=self._transport, follow_redirects=False)

    def _request(self, method: str, path: str, timeout_s: float, payload: Optional[dict] = None) -> tuple[dict, httpx.Response]:
        deadline = time.monotonic() + timeout_s
        client = self._client(timeout_s)
        try:
            with client, client.stream(method, path, json=payload) as r:
                chunks = []
                for chunk in r.iter_bytes():
                    chunks.append(chunk)
                    if time.monotonic() > deadline:
                        raise ProviderError("timeout")
                raw = b"".join(chunks)
        except httpx.TimeoutException as e:
            raise ProviderError("timeout") from e
        except httpx.HTTPError as e:
            # Bağlantı düzeyi hata: yalnızca sınıf adı tutulur (ör. RemoteProtocolError, ConnectError).
            raise ProviderError("unavailable", code=f"transport:{type(e).__name__}") from e
        try:
            body = json.loads(raw) if raw.strip() else {}
        except ValueError:
            body = {}
        if r.status_code >= 400:
            raise ProviderError(_error_kind(r.status_code, body if isinstance(body, dict) else {}), r.status_code,
                                _retry_after(r), **_diag(body))
        if not isinstance(body, dict):
            raise ProviderError("invalid_response", r.status_code)
        return body, r

    def models(self) -> list[dict]:
        with self._lock:
            if self._models is not None and time.monotonic() - self._models_at < MODELS_TTL_S:
                return self._models
        body, _ = self._request("GET", "/models", 10.0)
        data = [m for m in body.get("data") or [] if isinstance(m, dict) and isinstance(m.get("id"), str)]
        with self._lock:
            self._models, self._models_at = data, time.monotonic()
        return data

    def key_info(self) -> dict:
        """`GET /key`: anahtarın kullanım ve sınır bilgisi (token harcamaz)."""
        body, _ = self._request("GET", "/key", 20.0)
        return body.get("data") if isinstance(body.get("data"), dict) else body

    def chat(self, model: str, messages: list[dict], max_tokens: int, temperature: float = 0.2,
             json_mode: bool = False, timeout_s: float = 60.0) -> ChatResult:
        if not self.allow_paid and not is_free_model(model):
            raise ProviderError("paid_model_blocked")
        payload = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature,
                   "stream": False}
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        if self.reasoning == "off":
            payload["reasoning"] = {"enabled": False}
        elif self.reasoning == "low":
            payload["reasoning"] = {"effort": "low", "exclude": True}
        t0 = time.perf_counter()
        body, r = self._request("POST", "/chat/completions", timeout_s, payload)
        if isinstance(body.get("error"), dict):  # üretim sırasında oluşan hatalar 200 gövdesinde gelebilir
            code = str(body["error"].get("code") or "")
            status = int(code) if code.isdigit() else 502
            raise ProviderError(_error_kind(status, body), status, **_diag(body))
        try:
            choice = body["choices"][0]
            text = choice["message"].get("content") or ""
            if isinstance(text, list):  # bazı sunucular içerik parçaları döner
                text = "".join(p.get("text", "") for p in text if isinstance(p, dict))
            usage = body.get("usage") or {}
            cost = float(usage.get("cost") or 0.0)
        except (KeyError, IndexError, TypeError, AttributeError, ValueError) as e:
            raise ProviderError("invalid_response", r.status_code) from e
        served = str(body.get("model") or model)
        if _base_id(served) != _base_id(model):
            raise ProviderError("model_mismatch", r.status_code)
        if cost > 0 and not self.allow_paid:
            raise ProviderError("paid_usage_detected", r.status_code)
        if choice.get("finish_reason") == "error":
            native = re.sub(r"[^A-Za-z0-9_.:-]", "", str(choice.get("native_finish_reason") or ""))[:40]
            raise ProviderError("unavailable", r.status_code, code=f"finish_reason:error{':' + native if native else ''}",
                                upstream=re.sub(r"[^A-Za-z0-9_. -]", "", str(body.get("provider") or ""))[:40])
        return ChatResult(
            text=text, model=served,
            prompt_tokens=int(usage.get("prompt_tokens") or 0), completion_tokens=int(usage.get("completion_tokens") or 0),
            latency_ms=int((time.perf_counter() - t0) * 1000), request_id=body.get("id"),
            finish_reason=choice.get("finish_reason"), cost=cost,
            headers={k: v for k, v in r.headers.items() if k.lower().startswith("x-ratelimit-")},
            upstream=re.sub(r"[^A-Za-z0-9_. -]", "", str(body.get("provider") or ""))[:40],
        )


class MockProvider:
    """Ağsız sahte sağlayıcı: `responder(model, messages) -> str` yanıtı üretir. Çağrılar `calls` listesinde tutulur."""

    name = "mock"

    def __init__(self, responder: Callable[[str, list[dict]], str], models: Optional[list[dict]] = None,
                 fail: Optional[ProviderError] = None):
        self.responder, self._models, self.fail = responder, models or [], fail
        self.calls: list[dict] = []

    def available(self) -> tuple[bool, str]:
        return True, KeyStatus.OK

    def models(self) -> list[dict]:
        return self._models

    def chat(self, model, messages, max_tokens, temperature=0.2, json_mode=False, timeout_s=60.0) -> ChatResult:
        self.calls.append({"model": model, "messages": messages, "max_tokens": max_tokens, "json_mode": json_mode})
        if self.fail is not None:
            raise self.fail
        text = self.responder(model, messages)
        # Görsel parçalar gerçek sağlayıcılardaki gibi sabit token sayılır (base64 uzunluğu değil).
        def size(content) -> int:
            if isinstance(content, list):
                return sum(4000 if p.get("type") == "image_url" else len(str(p.get("text", ""))) for p in content)
            return len(str(content))
        prompt = sum(size(m.get("content")) for m in messages) // 4
        return ChatResult(text=text, model=model, prompt_tokens=prompt, completion_tokens=len(text) // 4, latency_ms=1)
