"""Seslendirme (Faz 8): rehber anlatımının sesi bir ses servisinden üretilir ve dosya olarak önbelleğe alınır.

Sağlayıcı env ile seçilir (`VAKIFNAME_TTS_PROVIDER`): `off` (varsayılan; arayüz tarayıcı sesini kullanır) | `files`
(30 Ekim kararı: ekipten bir insan sesinin klonuyla **önceden üretilmiş** dosyalar; sunucu üretmez, yalnızca çalar; üretim
`python -m app.tts_export` + `scripts/voice/`, bkz. docs/SES_KAYDI.md) | `google` (Google Cloud Text-to-Speech, Chirp 3 HD;
yedek). Yenisi `TtsProvider` arayüzüyle eklenir.

Kurallar:
- Yalnızca eserin **onaylı anlatımına ait** cümle seslendirilir (`narration_texts`): karşılama/kapanış kalıbı ya da yayımlanmış
  bir kaydın metni (kesinlik ön ekiyle). Dışarıdan rastgele metin seslendirilip ücret yazdırılamaz.
- Her cümle bir kez üretilir; dosya adı (sağlayıcı, ses, hız, metin) özetidir. Önbellekteki dosya internetsiz de çalar.
- Anahtar yalnızca dosyadan okunur (`VAKIFNAME_TTS_GOOGLE_KEY_FILE`); günlüğe metin veya anahtar yazılmaz.
"""

import base64
import hashlib
import logging
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Protocol

import httpx

logger = logging.getLogger("vakifname.tts")

GOOGLE_URL = "https://texttospeech.googleapis.com/v1"
# Anlatım kalıpları: frontend/src/app/narration.ts ile birebir aynı olmalı (test denetler).
INTRO = "Hoş geldin! Ben buranın rehberiyim. Sana {name} hakkında kaynakların anlattıklarını aktaracağım."
OUTRO = "Merak ettiğin bir şey olursa bana yazabilirsin. Bilgilerimin kaynaklarını aşağıda görebilirsin."
PREFIX = {"reported": "Aktarılan bir rivayete göre: ", "uncertain": "Bu bilgi kesin değil: "}
# İngilizce anlatım (Faz 11): yalnızca onaylı İngilizce kayıtlar (`text_en`); kalıplar narration.ts ile aynı.
INTRO_EN = "Welcome! I am your guide here. Let me share what the sources tell us about {name}."
OUTRO_EN = "If you are curious about anything, write to me. You can see the sources of what I told you below."
PREFIX_EN = {"reported": "According to a reported tradition: ", "uncertain": "This is not certain: "}
LANGUAGES = {"tr": "tr-TR", "en": "en-US"}
MAX_TEXT = 1500


class TtsError(Exception):
    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


class TtsProvider(Protocol):
    name: str

    def synthesize(self, text: str, voice: str, language: str, rate: float) -> bytes: ...

    def voices(self, language: str) -> list[str]: ...


class GoogleTts:
    """Google Cloud Text-to-Speech (REST, API anahtarı). Çıktı MP3."""

    name = "google"

    def __init__(self, key: str, transport: Optional[httpx.BaseTransport] = None, timeout_s: float = 30.0):
        self._key, self._transport, self._timeout = key, transport, timeout_s

    def _client(self) -> httpx.Client:
        return httpx.Client(base_url=GOOGLE_URL, timeout=self._timeout, transport=self._transport,
                            headers={"X-Goog-Api-Key": self._key})

    def synthesize(self, text: str, voice: str, language: str, rate: float) -> bytes:
        body = {"input": {"text": text}, "voice": {"languageCode": language, "name": voice},
                "audioConfig": {"audioEncoding": "MP3", "speakingRate": rate}}
        try:
            with self._client() as c:
                r = c.post("/text:synthesize", json=body)
        except httpx.HTTPError as e:
            raise TtsError("unavailable") from e
        if r.status_code in (401, 403):
            raise TtsError("auth")
        if r.status_code == 429:
            raise TtsError("quota")
        if r.status_code != 200:
            raise TtsError(f"http_{r.status_code}")
        try:
            return base64.b64decode(r.json()["audioContent"])
        except (ValueError, KeyError) as e:
            raise TtsError("invalid_response") from e

    def voices(self, language: str) -> list[str]:
        try:
            with self._client() as c:
                r = c.get("/voices", params={"languageCode": language})
            r.raise_for_status()
            return [v["name"] for v in r.json().get("voices", [])]
        except (httpx.HTTPError, ValueError, KeyError) as e:
            raise TtsError("unavailable") from e


@dataclass
class TtsSettings:
    provider: str = "off"
    voice: str = "auto"
    voice_en: str = "auto"
    language: str = "tr-TR"
    rate: float = 1.0
    cache_dir: Optional[Path] = None
    key_file: Optional[Path] = None

    @classmethod
    def from_env(cls) -> "TtsSettings":
        e = os.environ.get
        provider = e("VAKIFNAME_TTS_PROVIDER", "off").strip().lower() or "off"
        if provider not in ("off", "files", "google"):
            raise ValueError(f"VAKIFNAME_TTS_PROVIDER={provider}: geçerli değerler off | files | google")
        cache = e("VAKIFNAME_TTS_CACHE_DIR", "").strip()
        key = e("VAKIFNAME_TTS_GOOGLE_KEY_FILE", "").strip()
        return cls(provider=provider, voice=e("VAKIFNAME_TTS_VOICE", "auto").strip() or "auto",
                   voice_en=e("VAKIFNAME_TTS_VOICE_EN", "auto").strip() or "auto",
                   rate=float(e("VAKIFNAME_TTS_RATE", "1.0")), cache_dir=Path(cache) if cache else None,
                   key_file=Path(key) if key else None)


def pick_voice(names: list[str], language: str = "tr-TR") -> Optional[str]:
    """Chirp 3 HD sesleri önce; aynı türde ilk ad (kararlı sıra)."""
    chirp = sorted(n for n in names if n.startswith(f"{language}-Chirp3-HD-"))
    return chirp[0] if chirp else (sorted(names)[0] if names else None)


def narration_texts(monument, lang: str = "tr") -> set[str]:
    """Eserin onaylı anlatımında geçebilecek seslendirme metinleri (narration.ts `spoken` alanı)."""
    if lang == "en":
        out = {INTRO_EN.format(name=monument.name_en or monument.name), OUTRO_EN}
        return out | {PREFIX_EN.get(f.certainty, "") + f.text_en for f in monument.facts if f.text_en}
    out = {INTRO.format(name=monument.name), OUTRO}
    for f in monument.facts:
        out.add(PREFIX.get(f.certainty, "") + f.text)
    return out


class SpeechService:
    def __init__(self, settings: TtsSettings, provider: Optional[TtsProvider] = None):
        self.settings = settings
        self.provider = provider
        # Dil başına ses: Türkçe `VAKIFNAME_TTS_VOICE`, İngilizce `VAKIFNAME_TTS_VOICE_EN` (auto = o dilin ilk Chirp 3 HD sesi).
        self._voices: dict[str, Optional[str]] = {
            "tr": None if settings.voice == "auto" else settings.voice,
            "en": None if settings.voice_en == "auto" else settings.voice_en,
        }
        self._lock = threading.Lock()
        self._inflight: dict[str, threading.Lock] = {}
        if settings.provider == "google" and provider is None:
            key = settings.key_file.read_text(encoding="utf-8").strip() if settings.key_file and settings.key_file.is_file() else ""
            self.provider = GoogleTts(key) if key else None
            if not key:
                logger.warning("Seslendirme: anahtar dosyası yok veya boş; tarayıcı sesi kullanılacak.")
        if self.enabled and settings.cache_dir:
            settings.cache_dir.mkdir(parents=True, exist_ok=True)

    @property
    def enabled(self) -> bool:
        if self.settings.provider == "off" or self.settings.cache_dir is None:
            return False
        return self.settings.provider == "files" or self.provider is not None

    @property
    def generates(self) -> bool:
        """Eksik ses istek anında üretilir mi (`files` üretmez: önceden üretilmemiş cümle tarayıcı sesine düşer)."""
        return self.settings.provider != "files"

    def voice(self, lang: str = "tr") -> Optional[str]:
        code = LANGUAGES[lang]
        if self.settings.provider == "files":
            return self._voices.get(lang) or "default"
        if self._voices.get(lang) is None and self.provider is not None:
            try:
                self._voices[lang] = pick_voice(self.provider.voices(code), code)
            except TtsError as e:
                logger.warning("Seslendirme: %s ses listesi alınamadı (%s).", code, e.kind)
        return self._voices.get(lang)

    def status(self) -> dict:
        return {"enabled": self.enabled, "provider": self.settings.provider if self.enabled else "browser",
                "voice": self._voices["tr"] if self.enabled else None}

    def file_for(self, text: str, lang: str = "tr") -> str:
        voice = self.voice(lang) or ""
        key = f"{self.settings.provider}|{lang}|{voice}|{self.settings.rate}|{text}".encode("utf-8")
        return hashlib.sha256(key).hexdigest() + ".mp3"

    def path(self, file: str) -> Optional[Path]:
        if not self.enabled:
            return None
        p = self.settings.cache_dir / file
        return p if p.is_file() else None

    def ensure(self, text: str, lang: str = "tr") -> tuple[str, bool]:
        """Cümlenin ses dosyası (yoksa üretir). (dosya adı, yeni mi) döner; hata `TtsError`."""
        if not self.enabled:
            raise TtsError("off")
        voice = self.voice(lang)
        if not voice:
            raise TtsError("no_voice")
        file = self.file_for(text, lang)
        target = self.settings.cache_dir / file
        if target.is_file():
            return file, False
        if not self.generates:
            raise TtsError("missing")
        with self._lock:
            lock = self._inflight.setdefault(file, threading.Lock())
        with lock:
            if target.is_file():
                return file, False
            audio = self.provider.synthesize(text, voice, LANGUAGES[lang], self.settings.rate)
            tmp = target.with_suffix(".tmp")
            tmp.write_bytes(audio)
            os.replace(tmp, target)
        with self._lock:
            self._inflight.pop(file, None)
        return file, True
