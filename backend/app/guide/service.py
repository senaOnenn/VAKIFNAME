"""Tarih rehberi servisi: fotoğraf gözlemi (VLM) → onaylı olgu seçimi → üretken cevap → kaynak denetimi.

Sağlayıcı yoksa, anahtar yüklenmemişse, bütçe dolduysa, devre kesici açıksa veya sağlayıcı hata verirse mevcut kaynaklı
arama (`app/ask`) cevap verir; ziyaretçiye bunun yedek cevap olduğu söylenir. Ücretli modele geçilmez. Fotoğraf, yerel
yüz taramasından geçmeden sağlayıcıya gönderilmez. Soru metni ve fotoğraf loglanmaz veya saklanmaz; yalnızca durum, süre
ve token sayıları loglanır.
"""

import logging
import os
import re
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ..ask.engine import CERTAINTY_LABELS
from ..ask.text import fold
from ..ask.service import AskService
from . import image as img
from . import privacy
from .budget import CircuitBreaker, DailyBudget
from .claims import PHOTO_ID, Checker, Sentence, parse
from .prompts import answer_messages, vision_messages
from .provider import DEFAULT_MODEL, ChatProvider, ProviderError
from .registry import known_models
from .retrieval import gather, identity_id, identity_text

logger = logging.getLogger("vakifname.guide")

NOTICE = ("Cevabı yapay zekâ, yalnızca yayın onayı verilmiş tarihî kayıtlardan yazar; her cümlenin dayandığı kayıt ve "
          "bağımsız kaynaklar altta gösterilir. Kayıtlarda olmayan bilgiyi tahmin etmez. Yapay zekâ yanılabilir; "
          "önemli bilgileri kaynağından kontrol edin. Cevap veren tarihî bir kişi değildir.")
PHOTO_NOTICE = ("Fotoğraf, konum ve cihaz bilgileri silinip yerel yüz taramasından geçtikten sonra analiz için OpenRouter "
                "üzerinden NVIDIA Nemotron modeline gönderilir ve VAKIFNAME'de saklanmaz. Ücretsiz uç noktada sağlayıcı "
                "gönderilen içeriği kaydedebilir.")

ERROR_MESSAGES = {
    "no_key": "Yapay zekâ rehberi henüz yapılandırılmadı.",
    "not_logged_in": "Yapay zekâ rehberi için sağlayıcı hesabında oturum açık değil.",
    "not_subscription": "Yapay zekâ rehberi abonelik girişiyle değil, API girişiyle açık; güvenlik için devre dışı.",
    "insecure_permissions": "Yapay zekâ rehberi yapılandırması güvenli değil; devre dışı.",
    "invalid": "Yapay zekâ rehberi yapılandırması geçersiz.",
    "auth": "Yapay zekâ sağlayıcısı kimlik doğrulamasını reddetti.",
    "quota": "Yapay zekâ sağlayıcısının bugünkü ücretsiz kullanım kotası doldu.",
    "budget": "Bugünkü yapay zekâ kullanım sınırı doldu.",
    "busy": "Yapay zekâ rehberi şu anda yoğun (dakikalık sınır doldu).",
    "rate_limited": "Yapay zekâ sağlayıcısı şu anda yoğun.",
    "moderation": "Yapay zekâ sağlayıcısı içeriği kabul etmedi.",
    "paid_model_blocked": "Yapılandırılan model ücretsiz değil; ücretli modele geçilmez.",
    "paid_usage_detected": "Yapay zekâ sağlayıcısı ücretli kullanım bildirdi; rehber güvenlik için durduruldu.",
    "model_mismatch": "Yapay zekâ sağlayıcısı istenenden farklı bir modelle yanıt verdi.",
    "circuit_open": "Yapay zekâ sağlayıcısına geçici olarak ulaşılamıyor.",
    "unavailable": "Yapay zekâ sağlayıcısına ulaşılamadı.",
    "timeout": "Yapay zekâ cevabı zamanında gelmedi.",
    "invalid_response": "Yapay zekâ sağlayıcısından okunamayan bir yanıt geldi.",
    "bad_request": "Yapay zekâ sağlayıcısı isteği kabul etmedi.",
    "parse_error": "Yapay zekâ cevabı beklenen biçimde değildi.",
    "vision_unsupported": "Fotoğraf analizi için uygun model bulunamadı.",
}


@dataclass
class GuideSettings:
    text_model: str = DEFAULT_MODEL
    vision_model: str = ""  # boş: metin modeli (görsel destekliyorsa)
    max_answer_tokens: int = 1000
    max_vision_tokens: int = 700
    temperature: float = 0.2
    # Tek çağrının ve bütün isteğin (fotoğraflı soruda iki çağrı) kesin üst sınırları. Gerçek testte bir çağrı 84 sn
    # sürdü; arayüz bekleme süresi (`GUIDE_TIMEOUT_MS`) `deadline_s`'den uzun tutulur, böylece süre dolunca ziyaretçi
    # boş bir hata yerine kaynaklı arama cevabı görür.
    timeout_s: float = 30.0
    vision_timeout_s: float = 25.0
    deadline_s: float = 50.0
    min_call_s: float = 8.0  # kalan süre bundan azsa çağrı hiç yapılmaz (kota harcanmaz)
    # Cevap çağrısında alt sağlayıcının hızlı geçici hatası (OpenRouter 502/503, ör. "upstream=Nvidia" 378–555 ms) bir
    # kez, kısa bir beklemeden sonra yeniden denenir; canlıda iki hatanın ikisinde de sonraki çağrı başarılıydı. Yeniden
    # deneme de bütçeden düşülür, süre sınırı ve devre kesici aynen uygulanır.
    retry_backoff_s: float = 1.5
    retry_fast_ms: int = 5000  # yalnızca bundan hızlı düşen çağrı yeniden denenir (yavaş hata zaten süreyi harcamıştır)
    history_turns: int = 4

    @classmethod
    def from_env(cls) -> "GuideSettings":
        e = os.environ.get
        return cls(text_model=e("VAKIFNAME_GUIDE_MODEL", cls.text_model),
                   vision_model=e("VAKIFNAME_GUIDE_VISION_MODEL", cls.vision_model),
                   max_answer_tokens=int(e("VAKIFNAME_GUIDE_MAX_ANSWER_TOKENS", cls.max_answer_tokens)),
                   timeout_s=float(e("VAKIFNAME_GUIDE_TIMEOUT_S", cls.timeout_s)),
                   vision_timeout_s=float(e("VAKIFNAME_GUIDE_VISION_TIMEOUT_S", cls.vision_timeout_s)),
                   deadline_s=float(e("VAKIFNAME_GUIDE_DEADLINE_S", cls.deadline_s)))


@dataclass
class Usage:
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0
    cost: float = 0.0
    models: list[str] = field(default_factory=list)
    deadline: float = float("inf")  # time.monotonic() cinsinden
    photo_monument: Optional[str] = None  # fotoğrafın güvenle eşleştiği eser (cevap çağrısı başarısız olursa yedek arama için)


def _supports_vision(m: dict) -> bool:
    """OpenRouter `/models`: `architecture.input_modalities`; diğer OpenAI uyumlu sunucular: `capabilities.vision`."""
    arch = m.get("architecture") or {}
    return "image" in (arch.get("input_modalities") or []) or bool((m.get("capabilities") or {}).get("vision"))


class GuideService:
    def __init__(self, ask: AskService, provider: Optional[ChatProvider], budget: DailyBudget,
                 settings: Optional[GuideSettings] = None, breaker: Optional[CircuitBreaker] = None,
                 face_screen: Optional[privacy.FaceScreen] = None, lexicon=None,
                 vision_provider: Optional[ChatProvider] = None, vision_breaker: Optional[CircuitBreaker] = None):
        self.ask_service, self.provider, self.budget = ask, provider, budget
        self.settings = settings or GuideSettings()
        self.breaker = breaker or CircuitBreaker()
        self.face_screen = face_screen
        # R5.3: fotoğraf gözlemi ayrı sağlayıcıyla yapılabilir (ör. metin Evren, görsel OpenRouter). Ayrı devre kesici:
        # görsel sağlayıcının kota/hata durumu metin rehberini durdurmaz. Verilmezse metin sağlayıcısı ve kesicisi (eski davranış).
        self.vision_provider = vision_provider
        self.vision_breaker = vision_breaker or (CircuitBreaker() if vision_provider is not None else None)
        self.lexicon = lexicon  # TurkishLexicon; yoksa bozuk sözcük denetimi yapılmaz
        self._lexicon_fed = False

    # --- Sağlayıcı ------------------------------------------------------------------------------------------------

    def _vision_provider(self) -> Optional[ChatProvider]:
        return self.vision_provider if self.vision_provider is not None else self.provider

    def _vision_breaker(self) -> CircuitBreaker:
        return self.vision_breaker if self.vision_breaker is not None else self.breaker

    def _model_info(self, model_id: str, provider: Optional[ChatProvider] = None) -> Optional[dict]:
        p = provider or self.provider
        if p is None:
            return None
        try:
            return next((m for m in p.models() if m.get("id") == model_id), None)
        except ProviderError:
            return None

    def vision_model(self) -> Optional[str]:
        """Kullanım anında doğrulanır: model, görsel sağlayıcının listesinde görsel girdiyi destekliyor olmalı."""
        mid = self.settings.vision_model or self.settings.text_model
        info = self._model_info(mid, self._vision_provider())
        return mid if info and _supports_vision(info) else None

    def _json_mode(self, model_id: str, provider: Optional[ChatProvider] = None) -> bool:
        info = self._model_info(model_id, provider)
        return bool(info and ("response_format" in (info.get("supported_parameters") or [])
                              or (info.get("capabilities") or {}).get("response_format")))

    def photo_enabled(self) -> bool:
        """Fotoğraf seçeneği yalnızca hepsi hazırsa sunulur: yerel yüz denetimi yüklü, görsel sağlayıcının anahtarı geçerli
        ve görsel model, sağlayıcının ağa çıkmadan bildirdiği listede metin-yalnız DEĞİL. Durum sorgusu ağa çıkmaz; liste
        henüz bilinmiyorsa (OpenRouter `/models` önbelleği boş) model ilk fotoğrafta doğrulanır, desteklemiyorsa analiz
        "başarısız" döner (başarılı gibi gösterilmez)."""
        if self.face_screen is None or not self.face_screen.available:
            return False
        p = self._vision_provider()
        if p is None or not p.available()[0]:
            return False
        return self._vision_declared() is not False

    def _vision_declared(self) -> Optional[bool]:
        """Görsel model ağsız bilinen listede var mı ve görsel girdi bildiriyor mu? Bilinmiyorsa None."""
        p = self._vision_provider()
        if p is None:
            return None
        mid = self.settings.vision_model or self.settings.text_model
        info = next((m for m in known_models(p) or [] if m.get("id") == mid), None)
        return None if info is None else _supports_vision(info)

    def _vision_status(self) -> dict:
        """Test anahtarıyla görülen ayrıntı: görsel sağlayıcı, anahtar durumu (değeri değil), yüz denetimi, kesici."""
        p = self._vision_provider()
        return {"provider": getattr(p, "name", None), "separate": self.vision_provider is not None,
                "key": p.available()[1] if p is not None else "missing",
                "model": self.settings.vision_model or self.settings.text_model, "declared": self._vision_declared(),
                "face_screen": bool(self.face_screen is not None and self.face_screen.available),
                "circuit": self._vision_breaker().state()}

    def _lexicon(self, engine):
        if self.lexicon is not None and not self._lexicon_fed:
            self.lexicon.add_words(d.text for d in engine.corpus.docs)  # onaylı katalogdaki sözcükler geçerlidir
            self._lexicon_fed = True
        return self.lexicon

    def _call(self, model: str, messages: list[dict], max_tokens: int, usage: Usage, est_tokens: int,
              timeout_s: Optional[float] = None, stage: str = "answer", provider: Optional[ChatProvider] = None,
              breaker: Optional[CircuitBreaker] = None) -> str:
        provider = provider or self.provider
        breaker = breaker or self.breaker
        if provider is None:
            raise ProviderError("no_key")
        ok, status = provider.available()
        if not ok:
            raise ProviderError("no_key" if status == "missing" else status)
        json_mode = self._json_mode(model, provider)
        for attempt in (1, 2):
            if not breaker.allow():
                raise ProviderError("circuit_open")
            timeout = min(timeout_s or self.settings.timeout_s, usage.deadline - time.monotonic())
            if timeout < self.settings.min_call_s:
                raise ProviderError("timeout")
            if not self.budget.reserve(est_tokens):
                raise ProviderError("busy" if self.budget.denied == "per_minute" else "budget")
            t0 = time.monotonic()
            try:
                r = provider.chat(model, messages, max_tokens=max_tokens, temperature=self.settings.temperature,
                                       json_mode=json_mode, timeout_s=timeout)
                break
            except ProviderError as e:
                ms = int((time.monotonic() - t0) * 1000)
                # Zaman aşımı ve hatalı çağrılar da kotadan düşülür: istek sağlayıcıya ulaşmış ve sayılmış olabilir.
                self.budget.settle(est_tokens, 0, 0, failed=True, latency_ms=ms, timed_out=e.kind == "timeout")
                breaker.failure(e.kind, e.retry_after)
                # Tanılama: aşama, deneme, HTTP durumu, OpenRouter hata kodu, alt sağlayıcı, süre. İçerik ve mesaj yazılmaz.
                logger.warning("guide call stage=%s result=error kind=%s http=%s code=%s upstream=%s ms=%d attempt=%d", stage,
                               e.kind, e.status, e.code or "-", e.upstream or "-", ms, attempt)
                # Fotoğraf gözlemi yeniden denenmez (önceki karar: tek çağrı); yalnızca cevap çağrısı.
                transient = stage == "answer" and e.kind == "unavailable" and e.status in (502, 503) \
                    and ms < self.settings.retry_fast_ms
                if attempt == 2 or not transient or \
                        usage.deadline - time.monotonic() - self.settings.retry_backoff_s < self.settings.min_call_s:
                    raise
                time.sleep(self.settings.retry_backoff_s)
        logger.info("guide call stage=%s result=ok http=200 upstream=%s finish=%s ms=%d tokens=%d/%d", stage,
                    r.upstream or "-", r.finish_reason or "-", r.latency_ms, r.prompt_tokens, r.completion_tokens)
        self.budget.settle(est_tokens, r.prompt_tokens, r.completion_tokens, latency_ms=r.latency_ms)
        breaker.success()
        usage.calls += 1
        usage.prompt_tokens += r.prompt_tokens
        usage.completion_tokens += r.completion_tokens
        usage.latency_ms += r.latency_ms
        usage.cost += r.cost
        usage.models.append(r.model)
        return r.text

    # --- Cevap ----------------------------------------------------------------------------------------------------

    def ask(self, question: str, monument_id: Optional[str] = None, history: Optional[list[dict]] = None,
            image_bytes: Optional[bytes] = None, lang: str = "tr") -> dict:
        t0 = time.perf_counter()
        usage = Usage(deadline=time.monotonic() + self.settings.deadline_s)
        if lang == "en" and image_bytes is None:
            try:
                res = self._answer_en(question, monument_id, (history or [])[-self.settings.history_turns:], usage)
            except ProviderError as e:
                self._log_provider_error(e)
                res = self._base("generative", "unavailable", EN_UNAVAILABLE, fallback_reason=e.kind)
            res["usage"] = {"calls": usage.calls, "prompt_tokens": usage.prompt_tokens,
                            "completion_tokens": usage.completion_tokens, "provider_latency_ms": usage.latency_ms,
                            "cost_usd": usage.cost, "total_ms": int((time.perf_counter() - t0) * 1000)}
            res["models"] = list(dict.fromkeys(usage.models))
            res["notice"] = EN_NOTICE
            res["question"] = question
            return res
        engine = self.ask_service.engine()
        history = (history or [])[-self.settings.history_turns:]
        photo, clean = None, None
        if image_bytes is not None:
            # ImageRejected → 400 (çağıran ele alır). Yüz taraması sağlayıcıya herhangi bir çağrıdan önce yapılır.
            clean = img.clean(image_bytes)
            privacy.screen(self.face_screen, clean.data)
        res = None
        en = lang == "en"
        if clean is not None:
            try:
                photo = self._observe(question, clean, engine, usage, lang="en" if en else "tr")
            except ProviderError as e:
                # Görsel analiz başarısız: açık eser sayfasının kayıtları fotoğrafın cevabıymış gibi gösterilmez, katalog
                # araması yapılmaz, fotoğrafın hangi esere ait olduğu varsayılmaz. Ziyaretçi tekrar deneyebilir, başka
                # fotoğraf yükleyebilir veya fotoğrafsız soru sorabilir.
                self._log_provider_error(e)
                res = self._photo_failed(e.kind)
        if res is None and en:
            # R6.17 İngilizce fotoğraf: gözlem ve eşleşme Türkçe yolla aynı kurallardan geçer; tarihî cevap yalnızca
            # eşleşen eserin onaylı İngilizce kayıtlarından gelir (Türkçe kayıt İngilizceye çevrilmez).
            try:
                res = self._photo_answer_en(question, monument_id, history, photo, engine, usage)
            except ProviderError as e:
                self._log_provider_error(e)
                res = self._base("generative", "unavailable", EN_UNAVAILABLE, fallback_reason=e.kind)
        if res is None:
            try:
                res = self._answer(question, monument_id, history, photo, engine, usage)
            except ProviderError as e:
                self._log_provider_error(e)
                # Fotoğraf varsa buraya yalnızca güvenilir eşleşmeden sonra gelinir: yedek arama o eserle sınırlıdır ve
                # gözlem korunur. Fotoğrafsız soruda açık eser bağlamı kullanılır.
                scope = usage.photo_monument if photo is not None else monument_id
                res = self._fallback(question, scope, e.kind, engine, photo_requested=False)
        if photo is not None:
            res["photo"] = {**{k: photo[k] for k in ("description", "features", "visible_text", "is_architecture",
                                                     "building_type", "architecture_explanation", "material_guess",
                                                     "identity", "synthetic_signs")},
                            "candidates": photo["candidates_view"], "metadata_removed": list(clean.removed),
                            # R5.7: denetimden geçen bir görsel betimleme var mı? Yoksa arayüz fotoğrafı yorumlamış gibi
                            # davranmaz (boş/elenmiş gözlem "görülenler" olarak gösterilmez).
                            "observed": bool(photo["description"] or photo["features"] or photo["architecture_explanation"])}
        res["usage"] = {"calls": usage.calls, "prompt_tokens": usage.prompt_tokens,
                        "completion_tokens": usage.completion_tokens, "provider_latency_ms": usage.latency_ms,
                        "cost_usd": usage.cost,
                        "total_ms": int((time.perf_counter() - t0) * 1000)}
        res["models"] = list(dict.fromkeys(usage.models))
        if en:
            res["message"] = EN_MESSAGES.get(res["message"], res["message"])
            for k in ("options", "manual_options"):
                res[k] = [{**o, "name": _name_en(engine, o["monument_id"])} for o in res.get(k) or []]
            res["notice"] = EN_NOTICE + " " + EN_PHOTO_NOTICE
        else:
            res["notice"] = NOTICE + (" " + PHOTO_NOTICE if clean is not None else "")
        logger.info("guide mode=%s status=%s fallback=%s calls=%d tokens=%d/%d cost=%.6f ms=%d removed=%d", res["mode"],
                    res["status"], res.get("fallback_reason"), usage.calls, usage.prompt_tokens, usage.completion_tokens,
                    usage.cost, res["usage"]["total_ms"], res.get("removed_claims", 0))
        return res

    @staticmethod
    def _log_provider_error(e: ProviderError):
        logger.warning("guide provider error kind=%s http=%s code=%s upstream=%s", e.kind, e.status, e.code or "-",
                       e.upstream or "-")

    def _photo_answer_en(self, question: str, monument_id: Optional[str], history: list[dict], photo: dict, engine,
                         usage: Usage) -> dict:
        if not photo["is_architecture"]:
            return self._base("generative", "monument_not_identified", EN_NOT_ARCHITECTURE,
                              manual_options=_options(engine, engine.corpus.monuments),
                              actions=["upload_another", "choose_manually"])
        candidate_ids, early = self._photo_monuments(question, monument_id, photo, engine)
        if early is not None:
            return early
        matched = candidate_ids[0] if candidate_ids else monument_id
        usage.photo_monument = matched
        res = self._answer_en(question, matched, history, usage, use_named=False)
        if res["status"] == "monument_not_identified":
            return self._not_matched(engine)
        return res

    def _photo_failed(self, kind: str) -> dict:
        logger.warning("guide photo analysis failed reason=%s", kind)
        reason = PHOTO_FAILED_REASON.get(kind, ERROR_MESSAGES.get(kind, ERROR_MESSAGES["unavailable"]))
        return self._base("generative", "photo_analysis_failed", f"Fotoğraf analiz edilemedi. {reason}",
                          fallback_reason=kind, actions=["retry_photo", "upload_another", "ask_without_photo"])

    def _base(self, mode: str, status: str, message: str, **extra) -> dict:
        return {"mode": mode, "status": status, "message": message, "sentences": [], "facts": [], "identities": [],
                "missing": "", "removed_claims": 0, "monument": None, "monuments": [], "options": [], "photo": None,
                "search": None, "fallback_reason": None, "manual_options": [], "actions": [], "interpreted_question": None,
                **extra}

    def _named_monument_en(self, question: str):
        """Soruda adı açıkça geçen tek eser (İngilizce ad, Türkçe ad, diğer adlar; "Bursa"/"Tomb of" ekleri olmadan da).
        Soruda birden fazla eser geçiyorsa eser seçilmez (karşılaştırma sorusu; tahmin yok)."""
        q = f" {fold(re.sub(r'[^0-9A-Za-zÀ-ÿĞğİıŞş]+', ' ', question))} "
        best, best_len, tie = None, 0, False
        hits = set()
        for m in self.ask_service.repo.catalog.monuments:
            names = {m.name, *(m.alternative_names or ())}
            if m.name_en:
                names |= {m.name_en, *(m.alternative_names_en or ())}
                base = re.sub(r"^(Bursa|Tomb of( Sultan)?)\s+", "", m.name_en)
                if base != m.name_en:
                    names |= {base, f"{base} Tomb", f"{base}'s tomb", f"{base} Türbesi"}
            for n in names:
                key = fold(re.sub(r"[^0-9A-Za-zÀ-ÿĞğİıŞş]+", " ", n)).strip()
                if len(key) < 5 or f" {key} " not in q:
                    continue
                hits.add(m.monument_id)
                if len(key) > best_len:
                    best, best_len, tie = m, len(key), False
                elif len(key) == best_len and best is not None and best.monument_id != m.monument_id:
                    tie = True
        return None if tie or len(hits) > 1 else best

    def _answer_en(self, question: str, monument_id: Optional[str], history: list[dict], usage: Usage,
                   use_named: bool = True) -> dict:
        """İngilizce rehber (Faz 11): yalnızca eserin onaylı İngilizce kayıtları (`text_en`; kitabın İngilizce bölümünden,
        yönetici onaylı). Her cümle dayandığı kayıt kimliğini taşır; kimliksiz cümle ve kayıtta geçmeyen sayı atılır."""
        # R6.17: soruda adı geçen eser açık sayfadakinden önce gelir (ana sayfadan ya da başka eserin sayfasından sorulabilir).
        named = self._named_monument_en(question) if use_named else None
        m = named or (self.ask_service.repo.get(monument_id) if monument_id else None)
        if m is None:
            return self._base("generative", "monument_not_identified",
                              "Which monument do you mean? Name it in your question (for example, “Who commissioned the "
                              "Bursa Grand Mosque?”) or ask me on its page, and I will answer from its approved English records.")
        name = m.name_en or m.name
        mon = {"monument_id": m.monument_id, "name": name}
        facts = [f for f in m.facts if f.text_en]
        if not facts:
            return self._base("generative", "insufficient_evidence",
                              f"I don't have approved English records for {name} yet. The Turkish records and their "
                              "sources are on this page.", monument=mon)
        records = "\n".join(f"[{f.fact_id}] ({f.certainty}) {f.text_en}" for f in facts)
        messages = [{"role": "system", "content": EN_SYSTEM}]
        for h in history:
            messages += [{"role": "user", "content": str(h.get("question", ""))[:500]},
                         {"role": "assistant", "content": str(h.get("answer", ""))[:800]}]
        messages.append({"role": "user", "content": f"Approved records about {name}:\n{records}\n\nQuestion: {question}"})
        text = self._call(self.settings.text_model, messages, self.settings.max_answer_tokens, usage, est_tokens=1500)
        data = parse(text) or {}
        valid = {f.fact_id: f for f in facts}
        sentences, removed = [], 0
        for s in data.get("sentences") or []:
            if not isinstance(s, dict):
                removed += 1
                continue
            t = str(s.get("text") or "").strip()
            ids = [i for i in (s.get("sources") or []) if isinstance(i, str) and i in valid]
            numbers = set(re.findall(r"\d+", t))
            cited = " ".join(valid[i].text_en for i in ids)
            if not t or not ids or any(n not in cited for n in numbers):
                removed += 1
                continue
            sentences.append({"text": t[:400], "sources": ids})
        if not sentences:
            return self._base("generative", "not_found", "I couldn't find this in my approved English records.",
                              monument=mon, removed_claims=removed)
        used = {i for s in sentences for i in s["sources"]}
        views = [{"fact_id": f.fact_id, "monument_id": m.monument_id, "monument_name": name, "title": f.title_en,
                  "text": f.text_en, "certainty": f.certainty, "certainty_label": CERTAINTY_EN.get(f.certainty, f.certainty),
                  "sources": [{"title": s.title, "publisher": s.publisher, "url": s.url} for s in f.sources],
                  "publication_decision_id": f.en_decision_id} for f in facts if f.fact_id in used]
        return self._base("generative", "answered", "", sentences=sentences, facts=views, monument=mon,
                          removed_claims=removed)

    def _observe(self, question: str, clean: img.CleanImage, engine, usage: Usage, lang: str = "tr") -> dict:
        """Görsel iki aşamada değerlendirilir: önce katalogdan bağımsız gözlem (yapı türü, özellikler, kimliğin
        belirlenebilirliği, olası yapay üretim işaretleri), sonra katalogla karşılaştırma. Model yalnızca 10 eserden
        birini seçmeye zorlanmaz; açık uyum yoksa eşleşme boş kalır."""
        model = self.vision_model()
        if model is None:
            raise ProviderError("vision_unsupported")
        monuments = list(engine.corpus.monuments.values())
        en = lang == "en"
        messages = vision_messages(question, clean.data_url(), monuments)
        if en:
            # Serbest metin alanları İngilizce istenir; sabit değerli alanlar (tür, kimlik, olasılık) aynı kalır.
            messages[-1]["content"].append({"type": "text", "text": VISION_EN})
        style, hedge, definitive, visible_of = ((_STYLE_EN, _HEDGE_EN, _DEFINITIVE_EN, _visible_parts_en) if en else
                                                (_STYLE, _HEDGE, _DEFINITIVE, _visible_parts))
        text = self._call(model, messages, self.settings.max_vision_tokens,
                          usage, est_tokens=3000, timeout_s=self.settings.vision_timeout_s, stage="vision",
                          provider=self._vision_provider(), breaker=self._vision_breaker())
        data = parse(text) or {}
        visible = str(data.get("visible_text") or "")[:200]
        # Gözlem metni de denetlenir: tarih, kişi, malzeme, tarihî olay veya yapı/yer adı içeren cümleler gösterilmez.
        # Ad yalnızca fotoğrafta okunan yazıda geçiyorsa kalabilir. Eser kimliği gözlemde söylenmez; yalnızca katalog
        # karşılaştırmasının sonucu olarak, olasılık derecesiyle gösterilir.
        checker = Checker({}, [d.text for d in engine.corpus.docs], [visible])
        lex = None if en else self._lexicon(engine)  # sözlük Türkçedir; İngilizce gözlemde kullanılmaz
        dropped_words = []

        def ok(t: str, phrase: bool = False, material: bool = False) -> bool:
            if checker._check(Sentence(t, [PHOTO_ID])) is not None and not (material and _only_material(checker, t)):
                return False
            if not _no_names(t, visible, phrase) or style.search(fold(t)):
                return False
            bad = lex.unknown_words(t, visible) if lex is not None else []
            dropped_words.extend(bad)  # bozuk Türkçe sözcük ("okşu", "duşarlı"): ifade gösterilmez
            return not bad

        sentences = lambda v, n: " ".join(x for x in _sentences(str(v or "")) if ok(x))[:n]
        desc = sentences(data.get("description"), 900)
        feats = [str(f)[:80] for f in (data.get("features") or []) if isinstance(f, (str, int))][:10]
        feats = [f for f in feats if ok(f, phrase=True)]
        # Açıklama yalnızca fotoğrafta görülen öğeleri anlatabilir: betimlemede veya özelliklerde geçmeyen bir mimari
        # öğeyi (ör. avlu görünmüyorken "revak") açıklayan cümle gösterilmez.
        seen = visible_of(" ".join([desc, *feats]))
        explanation = " ".join(x for x in _sentences(str(data.get("architecture_explanation") or ""))
                               if ok(x) and visible_of(x) <= seen)[:700]
        # Malzeme izlenimi ayrı ve ihtiyatlı: yalnızca "benziyor/olabilir" gibi çekinceli bir görsel tahmin gösterilir;
        # tarihî kaynak bilgisi değildir ve cevap istemine konmaz (malzeme iddiası yalnızca onaylı kayıttan gelir).
        mg = data.get("material_guess")
        mg_text = str((mg.get("text") if isinstance(mg, dict) else mg) or "")[:200]
        material = mg_text if mg_text and hedge.search(fold(mg_text)) and not definitive.search(fold(mg_text)) \
            and ok(mg_text, material=True) else ""
        btype = str(data.get("building_type") or "").strip().lower()
        btype = btype if btype in BUILDING_TYPES else "belirsiz"
        ident = data.get("identity") if isinstance(data.get("identity"), dict) else {}
        identifiable = ident.get("identifiable") if ident.get("identifiable") in ("yes", "no", "uncertain") else "uncertain"
        reason = sentences(ident.get("reason"), 200)
        signs = [str(x)[:120] for x in (data.get("synthetic_signs") or []) if isinstance(x, str)][:4]
        # Yapay üretim işaretleri yalnızca olasılık olarak gösterilir; kesin yargı içeren ifade atılır.
        signs = [x for x in signs if ok(x) and not definitive.search(fold(x))]
        raw = data.get("catalog_match") if "catalog_match" in data else data.get("candidates")
        cands, dropped = [], 0
        for c in raw or []:
            if not (isinstance(c, dict) and c.get("monument_id") in engine.corpus.monuments and c.get("likelihood") in ("high", "medium")):
                continue  # "low" eşleşme sayılmaz, öneri olarak da gösterilmez
            if not _type_compatible(btype, engine.corpus.monuments[c["monument_id"]].type):
                dropped += 1  # ör. görülen yapı cami, aday han: tür çelişiyorsa eşleşme kabul edilmez
                continue
            cands.append({"monument_id": c["monument_id"], "likelihood": c["likelihood"]})
        cands = list({c["monument_id"]: c for c in cands}.values())[:3]
        logger.info("guide vision type=%s identifiable=%s matches=%s type_mismatch=%d signs=%d broken_words=%d", btype,
                    identifiable, ",".join(f"{c['monument_id']}:{c['likelihood']}" for c in cands) or "-", dropped,
                    len(signs), len(dropped_words))
        # Yalnızca "yüksek" eşleşme ziyaretçiye gösterilir; "orta" benzerlik (çoğu kez yalnızca aynı yapı türü) öneriye
        # dönüşüp yanlış kimliklendirmeye yöneltmesin diye yanıta konmaz, yalnızca loglanır.
        cands = [c for c in cands if c["likelihood"] == "high"]
        return {"is_architecture": bool(data.get("is_architecture", True)), "building_type": btype, "description": desc,
                "features": feats, "architecture_explanation": explanation, "material_guess": material, "visible_text": visible,
                "identity": {"identifiable": identifiable, "reason": reason}, "synthetic_signs": signs, "candidates": cands,
                "candidates_view": [{**c, "name": _name_en(engine, c["monument_id"]) if en else
                                     engine.corpus.monuments[c["monument_id"]].name} for c in cands]}

    def _not_matched(self, engine, named: list[str] = ()) -> dict:
        """Güvenilir eşleşme yok. En yakın eser önerilmez: ziyaretçi mimarinin açıklamasını görebilir, başka fotoğraf
        yükleyebilir veya eseri kendisi seçebilir (tarafsız katalog sırası). Yalnızca soruda adıyla andığı eser ayrıca
        düğme olarak verilir."""
        return self._base("generative", "photo_not_matched", NOT_MATCHED, options=_options(engine, named),
                          manual_options=_options(engine, engine.corpus.monuments),
                          actions=["explain_architecture", "upload_another", "choose_manually"])

    def _photo_monuments(self, question: str, monument_id: Optional[str], photo: dict, engine) -> tuple[Optional[list[str]], Optional[dict]]:
        """(aday eser kimlikleri, erken dönüş). Yalnızca tek "yüksek" eşleşme güvenilir sayılır; "orta" eşleşme,
        açık eser sayfası veya sorudaki eser adı fotoğrafa kimlik atamaz."""
        q = engine.corpus.analyzer.analyze(question)
        high = [c["monument_id"] for c in photo["candidates"] if c["likelihood"] == "high"]
        named = list(q.monuments) or (list(q.ambiguous[1]) if q.ambiguous else [])
        if named:
            # Ziyaretçi eseri adıyla soruyor ("Bu Ulu Cami mi?"): fotoğraf o esere güvenle benzemiyorsa evet denmez.
            hit = [m for m in named if m in high]
            if len(hit) == 1:
                return hit, None
            return None, self._not_matched(engine, named)
        if monument_id:
            if high == [monument_id]:
                return None, None
            if high:
                return None, self._base("generative", "clarification_required",
                                        "Fotoğraf açık olan eserden farklı, kayıtlı bir esere benziyor (görsel benzerlik, kesin "
                                        "kimlik değildir). Onu mu soruyorsunuz?", options=_options(engine, high),
                                        manual_options=_options(engine, engine.corpus.monuments),
                                        actions=["explain_architecture", "upload_another", "choose_manually"])
            return None, self._not_matched(engine)
        if len(high) == 1:
            return high, None
        if high:
            return None, self._base("generative", "clarification_required",
                                    "Fotoğraf birden fazla kayıtlı esere benziyor (görsel benzerlik, kesin kimlik değildir). "
                                    "Hangisini soruyorsunuz?", options=_options(engine, high),
                                    manual_options=_options(engine, engine.corpus.monuments),
                                    actions=["explain_architecture", "upload_another", "choose_manually"])
        return None, self._not_matched(engine)

    def _answer(self, question: str, monument_id: Optional[str], history: list[dict], photo: Optional[dict], engine,
                usage: Usage) -> dict:
        candidate_ids = None
        if photo is not None:
            if not photo["is_architecture"]:
                return self._base("generative", "monument_not_identified",
                                  "Fotoğrafta bir yapı seçemedim. Bir eserin dış ya da iç görünüşünü içeren bir fotoğraf deneyin.",
                                  manual_options=_options(engine, engine.corpus.monuments),
                                  actions=["upload_another", "choose_manually"])
            candidate_ids, early = self._photo_monuments(question, monument_id, photo, engine)
            if early is not None:
                return early
            usage.photo_monument = candidate_ids[0] if candidate_ids else monument_id
        # Takip sorularında ("peki ne zaman?") eser önceki sorudan gelir: istemci `monument_id` gönderir; arama
        # sorgusuna önceki soru da eklenir.
        extra = " ".join(filter(None, [history[-1]["question"] if history else "",
                                       " ".join(photo["features"]) if photo else ""]))
        ev = gather(engine, question, monument_id, extra_query=extra, candidate_ids=candidate_ids)
        if ev.status == "clarify":
            return self._base("generative", "clarification_required", ev.message, options=ev.options)
        if ev.status == "not_in_catalog":
            return self._base("generative", "monument_not_in_catalog",
                              ev.message + " Başka bir eserin bilgisiyle cevap vermiyorum.")
        if ev.status == "empty":
            return self._base("generative", "unavailable", ev.message)
        identities = {identity_id(m.monument_id): identity_text(m) for m in ev.monuments}
        support = {**identities, **{d.fact_id: f"{d.monument_name}. {d.title}. {d.text}" for d in ev.docs}}
        messages = answer_messages(question, ev.docs, identities, history, photo, interpreted=ev.interpreted)
        est = sum(len(str(m["content"])) for m in messages) // 3 + self.settings.max_answer_tokens
        text = self._call(self.settings.text_model, messages, self.settings.max_answer_tokens, usage, est_tokens=est)
        checker = Checker(support, [d.text for d in engine.corpus.docs], [n for m in ev.monuments for n in (m.name, *m.alternative_names)],
                          photo_allowed=photo is not None)
        data = parse(text)
        if data is None:
            raise ProviderError("parse_error")
        checked = checker.check(data)
        by_id = {d.fact_id: d for d in ev.docs}
        facts = [_fact_view(by_id[i]) for i in checked.cited if i in by_id]
        ids = [{"id": i, "monument_id": m.monument_id, "name": m.name} for m in ev.monuments
               if (i := identity_id(m.monument_id)) in checked.cited]
        main = ev.monuments[0] if len(ev.monuments) == 1 else None
        if checked.status == "answered":
            message = "Onaylı kayıtlara dayanan cevap:"
        else:
            message = ("Bu soruyu cevaplayan onaylı bir tarihî kayıt bulamadım. Yanlış bilgi vermemek için tahmin etmiyorum."
                       + (f" {checked.missing}" if checked.missing else ""))
        res = self._base("generative", checked.status, message,
                         sentences=[{"text": s.text, "sources": s.sources} for s in checked.sentences],
                         facts=facts, identities=ids, missing=checked.missing, removed_claims=len(checked.removed),
                         monument=({"monument_id": main.monument_id, "name": main.name} if main else None),
                         monuments=[{"monument_id": m.monument_id, "name": m.name} for m in ev.monuments],
                         interpreted_question=ev.interpreted)
        res["_removed"] = checked.removed  # yalnızca değerlendirme için; rota bunu yanıttan çıkarır
        return res

    def _fallback(self, question: str, monument_id: Optional[str], reason: str, engine, photo_requested: bool) -> dict:
        logger.warning("guide fallback reason=%s", reason)
        search = engine.ask(question, monument_id)
        msg = ERROR_MESSAGES.get(reason, ERROR_MESSAGES["unavailable"]) + " Bunun yerine onaylı katalogda arama yapıldı."
        if search["status"] == "answered":
            msg += " Aşağıdaki bilgi yapay zekâ tarafından üretilmedi; onaylı kaydın özgün metnidir ve kaynaklarıyla gösterilir."
        if photo_requested:
            msg += " Fotoğraf bu nedenle analiz edilemedi."
        return self._base("fallback_search", search["status"], msg, search=search, fallback_reason=reason,
                          monument=search.get("monument"), options=search.get("options") or [])

    def status(self) -> dict:
        ok, key_status = (self.provider.available() if self.provider else (False, "missing"))
        return {"provider": getattr(self.provider, "name", None), "key": key_status, "configured": ok,
                "text_model": self.settings.text_model, "vision_model": self.settings.vision_model or self.settings.text_model,
                "photo_enabled": self.photo_enabled(), "budget": self.budget.status(), "circuit": self.breaker.state(),
                "vision": self._vision_status(),
                "deadline_s": self.settings.deadline_s,
                "lexicon": getattr(self.lexicon, "state", "disabled"),
                "account": (self.provider.describe() if hasattr(self.provider, "describe") else {}) if self.provider else {}}


# R5.7: eşleşmeme bir hata değil, ikincil bilgidir: fotoğrafın betimlemesi (varsa) ayrıca gösterilir; kimlik, kurucu,
# tarih veya konum söylenmez.
NOT_MATCHED = ("Fotoğraftaki yapı kayıtlı eserlerden biriyle güvenilir şekilde eşleşmedi; bu yüzden yapının adı, "
               "yaptıranı, tarihi veya konumu hakkında bilgi veremiyorum.")
# Ziyaretçiye teknik ayrıntı (HTTP durumu, hata kodu, sağlayıcı adı) gösterilmez.
PHOTO_FAILED_REASON = {
    "timeout": "Yapay zekâ fotoğrafı zamanında inceleyemedi.",
    "unavailable": "Yapay zekâ sağlayıcısına şu anda ulaşılamıyor.",
    "rate_limited": "Yapay zekâ sağlayıcısı şu anda yoğun.",
    "busy": "Yapay zekâ rehberi şu anda yoğun.",
    "circuit_open": "Yapay zekâ sağlayıcısına geçici olarak ulaşılamıyor.",
    "vision_unsupported": "Fotoğraf analizi şu anda kullanılamıyor.",
}
BUILDING_TYPES = ("cami", "külliye", "medrese", "türbe", "han", "bedesten", "kilise", "saray", "konut", "köprü", "kale",
                  "diğer", "belirsiz")
# Görülen yapı türü ile katalogdaki türün uyumu; "diğer"/"belirsiz" her türle uyumlu sayılır (model emin değil).
_COMPATIBLE = {"cami": {"cami", "külliye"}, "külliye": {"cami", "medrese", "türbe", "külliye"}, "medrese": {"medrese", "külliye"},
               "türbe": {"türbe"}, "han": {"han", "bedesten"}, "bedesten": {"bedesten", "han"}}
_DEFINITIVE = re.compile(r"kesin|uretilmistir|uretildigi aci|sahte|kanit")
# Gözlemde üslup/dönem atfı da tarihî çıkarımdır ("Osmanlı üslubunda", "Selçuklu dönemi") ve gösterilmez.
_STYLE = re.compile(r"\b(uslu|osmanl|selcuk|bizans|memluk|beylik|barok|gotik|rokoko|neoklasik)")
_CAP_WORD = re.compile(r"[A-ZÇĞİÖŞÜÂÎÛ][\wçğıöşüâîû]*")


_HEDGE = re.compile(r"olabilir|benziyor|benzer|gorunuyor|izlenimi|andiriyor|muhtemel|tahmin")
# Açıklamada anılması için fotoğrafta görülmüş olması gereken başlıca öğeler. Kemer, pencere, kapı gibi alt öğeler
# serbesttir ("revak, kemerli geçittir" demek için kemerin ayrıca sayılması gerekmez).
_VISIBLE = ("minare", "kubbe", "sadirvan", "avlu", "revak", "mihra", "minber", "kitabe", "sebil", "kasnak", "seref",
            "tonoz", "eyvan", "cesme")


# R6.17: İngilizce gözlem için aynı denetimlerin İngilizce kalıpları (fold sonrası küçük harf).
_DEFINITIVE_EN = re.compile(r"certain|definitely|clearly generated|is fake|fake|proof|proves")
_STYLE_EN = re.compile(r"\b(style|ottoman|seljuk|byzantin|mamluk|beylik|baroque|gothic|rococo|neoclassic)")
_HEDGE_EN = re.compile(r"\b(may|might|could|appear\w*|seem\w*|looks? like|resembl\w*|possibl\w*|probabl\w*|likely|impression)\b")
_VISIBLE_EN = {"minaret": "minare", "dome": "kubbe", "shadirvan": "sadirvan", "ablution": "sadirvan", "courtyard": "avlu",
               "portico": "revak", "arcade": "revak", "mihrab": "mihra", "minbar": "minber", "inscription": "kitabe",
               "sebil": "sebil", "drum": "kasnak", "balcon": "seref", "vault": "tonoz", "iwan": "eyvan", "fountain": "cesme"}


def _visible_parts_en(text: str) -> set[str]:
    return {v for w in fold(text).split() for k, v in _VISIBLE_EN.items() if w.startswith(k)}


def _name_en(engine, monument_id: str) -> str:
    m = engine.corpus.monuments.get(monument_id)
    if m is None:
        return monument_id
    return getattr(m, "name_en", None) or m.name


def _visible_parts(text: str) -> set[str]:
    return {p for w in fold(text).split() for p in _VISIBLE if w.startswith(p)}


def _only_material(checker: Checker, text: str) -> bool:
    """Cümle yalnızca malzeme kuralına takılıyorsa (çekinceli malzeme izlenimi için) True."""
    return checker._check(Sentence(text, [PHOTO_ID])) == "fotoğraftan malzeme"


def _type_compatible(seen: str, catalog_type: str) -> bool:
    return seen in ("diğer", "belirsiz") or catalog_type in _COMPATIBLE.get(seen, {seen})


def _no_names(text: str, visible: str, phrase: bool = False) -> bool:
    """Gözlem cümlesinde yapı, yer veya kişi adı olmamalı: cümle başı dışındaki büyük harfli sözcük veya kesme işaretli
    özel ad ("Selimiye'ye") cümleyi düşürür. Fotoğrafta okunan yazıdaki sözcükler serbesttir. `phrase`: kısa özellik
    ifadesi (normalde küçük harfle yazılır); baştaki büyük harfli sözcük de ad sayılır ("Selimiye tipi plan")."""
    allowed = {fold(w) for w in _CAP_WORD.findall(visible)} | {fold(w) for w in visible.split()}
    for m in re.finditer(r"[^.!?]+", text):
        words = re.findall(r"[\wÇĞİÖŞÜÂÎÛçğıöşüâîû]+(?:['’][\wçğıöşüâîû]+)?", m.group(0))
        for i, w in enumerate(words):
            if not w[0].isupper():
                continue
            base = re.split(r"['’]", w)[0]
            if fold(base) in allowed or fold(w) in allowed:
                continue
            if i > 0 or phrase or "'" in w or "’" in w:
                return False
    return True


def _options(engine, mids) -> list[dict]:
    return [{"monument_id": m, "name": engine.corpus.monuments[m].name} for m in dict.fromkeys(mids) if m in engine.corpus.monuments]


def _sentences(text: str) -> list[str]:
    # Yalnızca büyük harf veya tırnakla başlayan cümleden önce bölünür: "16. yüzyılda", "1. kat" bölünmez.
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜÂÎÛ\"“‘'(])", " ".join(text.split())) if s.strip()]


EN_SYSTEM = """You are the local guide of a historic foundation (waqf) building. Answer ONLY from the approved records you
are given. Rules:
- Every sentence must list the ids of the records it relies on.
- Do not add names, dates, numbers or facts that are not in those records. No general knowledge, no guesses.
- If a record is marked "reported" or "uncertain", say so ("According to tradition…", "It is not certain…").
- If the records do not answer the question, return {"sentences": []}.
- Warm, respectful and short: at most 4 sentences.
Return only one JSON object: {"sentences": [{"text": "...", "sources": ["<record id>"]}]}"""
EN_NOTICE = "The guide is a character (an impersonation). Every sentence is based on an approved record with its source."
EN_PHOTO_NOTICE = ("Your photo is sent for analysis to the NVIDIA Nemotron model via OpenRouter only after location and "
                   "device data are removed and a local face check is passed; VAKIFNAME does not store it. On the free "
                   "endpoint the provider may log the content sent.")
EN_NOT_ARCHITECTURE = "I couldn't find a building in this photo. Try a photo showing the outside or inside of a monument."
VISION_EN = ("LANGUAGE: write every free-text field (description, features, architecture_explanation, material_guess, "
             "identity.reason, synthetic_signs) in plain English. Keep the fixed values of building_type, identifiable and "
             "likelihood exactly as listed above (they are codes, not translated).")
# Türkçe yoldaki sabit fotoğraf mesajlarının İngilizcesi (tarihî bilgi içermez).
EN_MESSAGES = {
    NOT_MATCHED: "The building in the photo did not reliably match any of the registered monuments, so I cannot tell you "
                 "its name, who commissioned it, its date or its location.",
    "Fotoğraf açık olan eserden farklı, kayıtlı bir esere benziyor (görsel benzerlik, kesin kimlik değildir). Onu mu "
    "soruyorsunuz?": "The photo looks like a different registered monument from the one open on this page (visual "
                     "similarity, not a certain identification). Is that the one you mean?",
    "Fotoğraf birden fazla kayıtlı esere benziyor (görsel benzerlik, kesin kimlik değildir). Hangisini soruyorsunuz?":
        "The photo looks like more than one registered monument (visual similarity, not a certain identification). "
        "Which one do you mean?",
    **{f"Fotoğraf analiz edilemedi. {tr}": f"The photo could not be analysed. {en}" for tr, en in (
        ("Yapay zekâ fotoğrafı zamanında inceleyemedi.", "The AI could not examine the photo in time."),
        ("Yapay zekâ sağlayıcısına şu anda ulaşılamıyor.", "The AI provider cannot be reached right now."),
        ("Yapay zekâ sağlayıcısı şu anda yoğun.", "The AI provider is busy right now."),
        ("Yapay zekâ rehberi şu anda yoğun.", "The AI guide is busy right now."),
        ("Yapay zekâ sağlayıcısına geçici olarak ulaşılamıyor.", "The AI provider is temporarily unreachable."),
        ("Fotoğraf analizi şu anda kullanılamıyor.", "Photo analysis is not available right now."))},
}
EN_UNAVAILABLE = "The guide can't answer right now. You can read the approved records and their sources on this page."
CERTAINTY_EN = {"documented": "Documented in the sources", "reported": "Reported tradition", "uncertain": "Not certain"}


def _fact_view(d) -> dict:
    return {"fact_id": d.fact_id, "monument_id": d.monument_id, "monument_name": d.monument_name, "title": d.title,
            "text": d.text, "certainty": d.certainty, "certainty_label": CERTAINTY_LABELS.get(d.certainty, d.certainty),
            "sources": list(d.sources), "publication_decision_id": d.publication_decision_id}


DEFAULT_BUDGET_DB = Path("/var/lib/vakifname/guide/budget.sqlite3")


def budget_from_env() -> DailyBudget:
    """Varsayılanlar OpenRouter ücretsiz hesap sınırlarının (50 istek/gün, 20 istek/dakika; 2026-10-25'te doğrulandı)
    altındadır. Fotoğraflı soru 2 çağrı harcar (görsel gözlem + cevap). Sayaçlar varsayılan olarak
    `/var/lib/vakifname/guide/budget.sqlite3` dosyasında kalıcıdır; dosya açılamazsa günlük sınır sıfır olur (rehber
    çağrı yapmaz, kaynaklı arama sürer) — sayaçsız sınırsız çağrı riski alınmaz."""
    path = Path(os.environ.get("VAKIFNAME_GUIDE_BUDGET_DB") or DEFAULT_BUDGET_DB)
    calls = int(os.environ.get("VAKIFNAME_GUIDE_DAILY_CALLS", "40"))
    tokens = int(os.environ.get("VAKIFNAME_GUIDE_DAILY_TOKENS", "400000"))
    per_minute = int(os.environ.get("VAKIFNAME_GUIDE_CALLS_PER_MINUTE", "15"))
    try:
        return DailyBudget(path, calls, tokens, max_per_minute=per_minute)
    except (OSError, sqlite3.Error) as e:
        logger.error("guide budget db unavailable (%s); provider calls disabled", type(e).__name__)
        return DailyBudget(None, 0, 0, max_per_minute=0)
