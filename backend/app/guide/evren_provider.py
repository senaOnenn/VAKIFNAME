"""Evren LLM API sağlayıcısı (Anthropic Messages API uyumlu: `POST /v1/messages`).

Seçim (bkz. registry.py):
    VAKIFNAME_GUIDE_PROVIDER=evren
    VAKIFNAME_GUIDE_MODEL=glm-5.3                                   # verilmezse glm-5.3
    VAKIFNAME_EVREN_BASE_URL=https://evren-llmapi.ssyz.org.tr        # verilmezse bu adres
    VAKIFNAME_GUIDE_FALLBACK=none
Anahtar yalnızca dosyadan okunur (`secret.load_evren_key`; OpenRouter anahtarından bağımsız): `VAKIFNAME_EVREN_KEY_FILE`.

Arayüz `ChatProvider` ile aynıdır: servis OpenAI biçimli mesajlar verir (`system` / `user` / `assistant`, görseller
`image_url` data URL'si); burada Anthropic biçimine çevrilir: sistem mesajları ayrı `system` alanına, ardışık aynı roller
tek mesajda birleştirilir, görseller base64 `image` bloğuna. Yanıt `content` bloklarındaki `text` parçalarından okunur;
düşünme (`thinking`) blokları cevaba girmez. Token kullanımı `usage.input_tokens` / `usage.output_tokens`.

Anthropic API'sinde `response_format` yoktur: `json_mode=True` olduğunda sistem istemine "yalnızca JSON" talimatı eklenir
ve yanıttaki kod çiti/ön-arka metin ayıklanarak tek JSON nesnesi döndürülür (servisin `claims.parse` beklentisi).

Güvenlik: anahtar yalnızca istemcinin `x-api-key` başlığında durur, istemci her çağrıda kapatılır, yönlendirme izlenmez.
Anahtar düz HTTP ile gönderilmez (yalnızca https; testler için loopback http). İstek/yanıt metni ve sağlayıcının hata
mesajı loglanmaz ve hata nesnesine konmaz (mesaj anahtarı veya kullanıcı içeriğini yansıtabilir); yalnızca hata türü,
HTTP durumu ve temizlenmiş kısa hata tipi taşınır. Zaman aşımı, OpenRouter sağlayıcısındaki gibi bütün yanıt için kesin
üst sınırdır. 429'da yeniden deneme yapılmaz; `retry-after` servisin devre kesicisine iletilir. Yanıtı veren model
istenen model değilse cevap kullanılmaz (`model_mismatch`).

Görsel: modelin görsel desteği doğrulanmadığı için `models()` yalnızca metin bildirir; fotoğraflı soru bu sağlayıcıyla
"görsel desteklenmiyor" olarak kaynaklı aramaya düşer (servisin mevcut davranışı).
"""

import json
import re
import time
from typing import Callable, Optional

import httpx

from .provider import ChatResult, ProviderError, _retry_after
from .secret import KeyStatus, load_evren_key

DEFAULT_EVREN_BASE_URL = "https://evren-llmapi.ssyz.org.tr"
DEFAULT_EVREN_MODEL = "glm-5.3"
ANTHROPIC_VERSION = "2023-06-01"
MESSAGES_PATH = "/v1/messages"
MAX_RESPONSE_BYTES = 2_000_000
JSON_INSTRUCTION = ("Yalnızca geçerli tek bir JSON nesnesi döndür; önüne veya arkasına metin, açıklama ya da kod çiti "
                    "(```) ekleme.")
_MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$")
_DATA_URL = re.compile(r"^data:image/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$", re.S)
_LOOPBACK = {"127.0.0.1", "localhost", "::1", "[::1]"}
_FENCE = re.compile(r"^```[A-Za-z]*\s*|\s*```$")


def check_base_url(url: str) -> str:
    """Anahtar şifresiz bağlantıyla gönderilmez: yalnızca https (testler için loopback http). Geçersizse ValueError."""
    try:
        u = httpx.URL(url.strip())
    except (httpx.InvalidURL, TypeError) as e:
        raise ValueError("VAKIFNAME_EVREN_BASE_URL geçerli bir adres değil.") from e
    if not u.host or (u.scheme != "https" and not (u.scheme == "http" and u.host in _LOOPBACK)):
        raise ValueError("VAKIFNAME_EVREN_BASE_URL https:// ile başlamalı (yalnızca yerel testte http://127.0.0.1).")
    if u.userinfo or u.query or u.fragment:
        raise ValueError("VAKIFNAME_EVREN_BASE_URL kullanıcı bilgisi, sorgu veya parça içeremez.")
    return str(u).rstrip("/")


def _clean(v, n: int = 40) -> str:
    return re.sub(r"[^A-Za-z0-9_.:/ -]", "", str(v or ""))[:n]


def _error_type(body) -> str:
    err = body.get("error") if isinstance(body, dict) else None
    return _clean(err.get("type")).lower() if isinstance(err, dict) else ""


def _error_kind(status: int, etype: str) -> str:
    """Anthropic hata türleri: authentication_error, permission_error, billing_error, rate_limit_error,
    not_found_error, invalid_request_error, request_too_large, api_error, overloaded_error (529)."""
    if status == 401 or etype == "authentication_error":
        return "auth"
    if status == 403 or etype == "permission_error":
        return "auth"
    if status == 402 or etype == "billing_error":
        return "quota"
    if status == 429 or etype == "rate_limit_error":
        return "rate_limited"
    if status == 529 or etype == "overloaded_error" or status == 408:
        return "unavailable"
    if 400 <= status < 500:
        return "bad_request"
    return "unavailable"


def _image_block(part: dict) -> dict:
    hit = _DATA_URL.match(str((part.get("image_url") or {}).get("url", "")))
    if not hit:  # uzak adres verilmez: sunucu dışarıya istek atmasın
        raise ProviderError("bad_request", code="image_format")
    media = "image/jpeg" if hit.group(1) in ("jpeg", "jpg") else f"image/{hit.group(1)}"
    return {"type": "image", "source": {"type": "base64", "media_type": media, "data": re.sub(r"\s", "", hit.group(2))}}


def _blocks(content) -> list[dict]:
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content.strip() else []
    out = []
    for p in content or []:
        if not isinstance(p, dict):
            raise ProviderError("bad_request", code="content_part")
        if p.get("type") == "text":
            if str(p.get("text", "")).strip():
                out.append({"type": "text", "text": str(p["text"])})
        elif p.get("type") == "image_url":
            out.append(_image_block(p))
        else:
            raise ProviderError("bad_request", code="content_part")
    return out


def to_anthropic(messages: list[dict]) -> tuple[str, list[dict]]:
    """OpenAI biçimli mesajlar → (system, Anthropic mesajları). Sistem mesajları sırasıyla birleştirilir; ardışık aynı
    roller tek mesajda toplanır (API rollerin sırayla değişmesini ister); ilk mesaj kullanıcıdan olmalıdır."""
    system, out = [], []
    for m in messages:
        role = m.get("role")
        if role == "system":
            text = "\n".join(b["text"] for b in _blocks(m.get("content")) if b["type"] == "text")
            if text:
                system.append(text)
            continue
        if role not in ("user", "assistant"):
            raise ProviderError("bad_request", code="role")
        blocks = _blocks(m.get("content"))
        if not blocks:
            continue
        if out and out[-1]["role"] == role:
            out[-1]["content"].extend(blocks)
        else:
            out.append({"role": role, "content": blocks})
    if not out or out[0]["role"] != "user":
        raise ProviderError("bad_request", code="role_order")
    # Yalnızca metinden oluşan mesaj düz metin olarak gönderilir (en geniş uyumluluk).
    for m in out:
        if all(b["type"] == "text" for b in m["content"]):
            m["content"] = "\n\n".join(b["text"] for b in m["content"])
    return "\n\n".join(system), out


def json_text(text: str) -> str:
    """Yanıttan tek JSON nesnesini çıkarır (kod çiti, öndeki/arkadaki açıklama). Bulunamazsa metin aynen döner;
    biçim hatasına servis karar verir (`parse_error` → kaynaklı arama)."""
    s = _FENCE.sub("", text.strip()).strip()
    for candidate in (s, s[s.find("{"): s.rfind("}") + 1] if "{" in s and "}" in s else ""):
        if not candidate:
            continue
        try:
            if isinstance(json.loads(candidate), dict):
                return candidate
        except ValueError:
            pass
    return text


# Evren'in yanıtta farklı yazdığı, canlı tanılamayla DOĞRULANMIŞ model kimlikleri (istenen → dönen; tam eşleşme).
# Genel önek kaldırma yoktur: her yeni çift ancak gerçek yanıtta görüldükten sonra buraya eklenir.
_VERIFIED_SERVED = {"gemma-4-31b": {"google/gemma-4-31b"}}  # 2026-11-02 canlı test: HTTP 200, model=google/gemma-4-31b


def _same_model(served: str, requested: str) -> bool:
    s, r = served.strip().lower(), requested.strip().lower()
    if s in _VERIFIED_SERVED.get(r, ()):
        return True
    return s == r or s.startswith(r + "-")  # tarihli sürüm adı (ör. glm-5.3-20261001) aynı modeldir


class EvrenProvider:
    name = "evren"

    def __init__(self, base_url: str = DEFAULT_EVREN_BASE_URL, models: tuple[str, ...] = (DEFAULT_EVREN_MODEL,),
                 key_loader: Callable[[], tuple[Optional[str], str]] = load_evren_key,
                 transport: Optional[httpx.BaseTransport] = None):
        self.base_url = check_base_url(base_url)
        self.model_ids = tuple(dict.fromkeys(m for m in models if m)) or (DEFAULT_EVREN_MODEL,)
        self._key_loader = key_loader
        self._transport = transport

    def available(self) -> tuple[bool, str]:
        key, status = self._key_loader()
        return key is not None, status

    def describe(self) -> dict:
        return {"endpoint": httpx.URL(self.base_url).host}

    def models(self) -> list[dict]:
        """Ağ çağrısı yapmaz: yapılandırılan modeller (rehber ve içerik hattı). JSON çıktısı talimatla desteklenir;
        görsel bildirilmez."""
        return [{"id": m, "architecture": {"input_modalities": ["text"]},
                 "supported_parameters": ["max_tokens", "temperature", "response_format"]} for m in self.model_ids]

    def _client(self, timeout_s: float) -> httpx.Client:
        key, status = self._key_loader()
        if key is None:
            raise ProviderError("no_key" if status == KeyStatus.MISSING else status)
        return httpx.Client(base_url=self.base_url, timeout=httpx.Timeout(timeout_s, connect=min(10.0, timeout_s)),
                            headers={"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION,
                                     "content-type": "application/json", "accept": "application/json"},
                            transport=self._transport, follow_redirects=False)

    def _post(self, payload: dict, timeout_s: float) -> tuple[dict, httpx.Response]:
        deadline = time.monotonic() + timeout_s
        client = self._client(timeout_s)
        try:
            with client, client.stream("POST", MESSAGES_PATH, json=payload) as r:
                chunks, size = [], 0
                for chunk in r.iter_bytes():
                    chunks.append(chunk)
                    size += len(chunk)
                    if time.monotonic() > deadline:
                        raise ProviderError("timeout")
                    if size > MAX_RESPONSE_BYTES:
                        raise ProviderError("invalid_response", r.status_code, code="too_large")
                raw = b"".join(chunks)
        except httpx.TimeoutException as e:
            raise ProviderError("timeout") from e
        except httpx.HTTPError as e:
            raise ProviderError("unavailable", code=f"transport:{type(e).__name__}") from e
        try:
            body = json.loads(raw) if raw.strip() else None
        except ValueError:
            body = None
        if r.status_code >= 400 or (isinstance(body, dict) and body.get("type") == "error"):
            status = r.status_code if r.status_code >= 400 else 502
            etype = _error_type(body)
            raise ProviderError(_error_kind(status, etype), status, _retry_after(r), code=etype)
        if not isinstance(body, dict):
            raise ProviderError("invalid_response", r.status_code)
        return body, r

    def chat(self, model: str, messages: list[dict], max_tokens: int, temperature: float = 0.2,
             json_mode: bool = False, timeout_s: float = 60.0) -> ChatResult:
        if not isinstance(model, str) or not _MODEL_ID.match(model):
            raise ProviderError("bad_request", code="model_id")
        system, converted = to_anthropic(messages)
        if json_mode:
            system = f"{system}\n\n{JSON_INSTRUCTION}".strip()
        payload = {"model": model, "max_tokens": int(max_tokens), "messages": converted, "temperature": temperature,
                   "stream": False}
        if system:
            payload["system"] = system
        t0 = time.perf_counter()
        body, r = self._post(payload, timeout_s)
        served = body.get("model")
        content = body.get("content")
        if not isinstance(served, str) or not isinstance(content, list):
            raise ProviderError("invalid_response", r.status_code)
        if not _same_model(served, model):
            # Tanılama: yanıtı veren modelin kimliği (meta veri; anahtar veya içerik değil), temizlenmiş ve kısaltılmış.
            raise ProviderError("model_mismatch", r.status_code, code=f"served:{_clean(served, 60)}")
        stop = body.get("stop_reason")
        if stop == "refusal":
            raise ProviderError("moderation", r.status_code, code="refusal")
        text = "".join(b["text"] for b in content
                       if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str))
        if not text.strip():
            raise ProviderError("invalid_response", r.status_code, code="empty")
        if json_mode:
            text = json_text(text)
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        try:
            prompt_tokens = sum(int(usage.get(k) or 0) for k in
                                ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
            completion_tokens = int(usage.get("output_tokens") or 0)
        except (TypeError, ValueError) as e:
            raise ProviderError("invalid_response", r.status_code, code="usage") from e
        finish = {"end_turn": "stop", "stop_sequence": "stop", "max_tokens": "length"}.get(stop, _clean(stop) or None)
        return ChatResult(text=text, model=served, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                          latency_ms=int((time.perf_counter() - t0) * 1000), request_id=_clean(body.get("id"), 80) or None,
                          finish_reason=finish, cost=0.0,
                          headers={k: v for k, v in r.headers.items()
                                   if k.lower().startswith(("anthropic-ratelimit-", "x-ratelimit-"))})
