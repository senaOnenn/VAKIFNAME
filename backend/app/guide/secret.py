"""API anahtarını yalnızca dosyadan okur; ortam değişkeni, komut satırı veya kod içi anahtar kabul edilmez.

Arama sırası:
1. `$CREDENTIALS_DIRECTORY/openrouter_api_key` (systemd `LoadCredential=`; servis hesabına özel, bellekte tutulur).
2. `VAKIFNAME_OPENROUTER_KEY_FILE` ile gösterilen dosya (varsayılan `/etc/vakifname/secrets/openrouter_api_key`).

Dosya grup veya diğer kullanıcılar tarafından okunabiliyorsa ya da sahibi root veya servisi çalıştıran hesap değilse
anahtar reddedilir. Anahtar hiçbir zaman loglanmaz; hata
mesajları yalnızca durum kodunu taşır.

Windows: izin bitleri ve `os.geteuid()` anlamlı olmadığından aynı kural dosyanın erişim listesiyle (ACL) denetlenir:
sahip ve okuma izni yalnızca geçerli kullanıcı, SYSTEM ve Administrators olabilir (bkz. `secret_win.py`).

Evren LLM API anahtarı ayrı bir dosyadadır ve OpenRouter anahtarına hiçbir zaman düşmez (`load_evren_key`):
1. `$CREDENTIALS_DIRECTORY/evren_api_key`.
2. `VAKIFNAME_EVREN_KEY_FILE` (varsayılan Linux'ta `/etc/vakifname/secrets/evren_api_key`, Windows'ta
   `%LOCALAPPDATA%\\vakifname\\secrets\\evren_api_key`).
"""

import os
import stat
from pathlib import Path
from typing import Optional

DEFAULT_KEY_FILE = Path("/etc/vakifname/secrets/openrouter_api_key")
CREDENTIAL_NAME = "openrouter_api_key"
EVREN_CREDENTIAL_NAME = "evren_api_key"
MAX_KEY_BYTES = 512


class KeyStatus:
    MISSING = "missing"
    INSECURE = "insecure_permissions"
    INVALID = "invalid"
    OK = "ok"


def key_path() -> Path:
    creds = os.environ.get("CREDENTIALS_DIRECTORY")
    if creds and (Path(creds) / CREDENTIAL_NAME).is_file():
        return Path(creds) / CREDENTIAL_NAME
    return Path(os.environ.get("VAKIFNAME_OPENROUTER_KEY_FILE", str(DEFAULT_KEY_FILE)))


def default_evren_key_file() -> Path:
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "vakifname" / "secrets" / EVREN_CREDENTIAL_NAME
    return Path("/etc/vakifname/secrets") / EVREN_CREDENTIAL_NAME


def evren_key_path() -> Path:
    creds = os.environ.get("CREDENTIALS_DIRECTORY")
    if creds and (Path(creds) / EVREN_CREDENTIAL_NAME).is_file():
        return Path(creds) / EVREN_CREDENTIAL_NAME
    return Path(os.environ.get("VAKIFNAME_EVREN_KEY_FILE") or str(default_evren_key_file()))


def load_evren_key() -> tuple[Optional[str], str]:
    """Evren anahtarı: yalnızca kendi dosyasından (OpenRouter anahtarı yedek olarak kullanılmaz)."""
    return load_key(evren_key_path())


def _private(path: Path, st: os.stat_result) -> bool:
    """Dosyayı yalnızca sahibi okuyabiliyor ve sahibi güvenilir hesap mı? Linux: izin bitleri + sahip (değişmedi).
    Windows: erişim listesi (ACL) ve sahip SID'i."""
    if os.name == "nt":
        from .secret_win import private_to_current_user

        return private_to_current_user(str(path))
    return not st.st_mode & (stat.S_IRWXG | stat.S_IRWXO) and st.st_uid in (0, os.geteuid())


def load_key(path: Optional[Path] = None) -> tuple[Optional[str], str]:
    """(anahtar, durum). Anahtar yoksa veya güvensizse (None, durum) döner; istisna fırlatmaz."""
    path = Path(path) if path else key_path()
    try:
        st = path.stat()
    except OSError:
        return None, KeyStatus.MISSING
    if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_KEY_BYTES:
        return None, KeyStatus.INVALID
    if not _private(path, st):
        return None, KeyStatus.INSECURE
    try:
        key = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return None, KeyStatus.INVALID
    if not key or any(c.isspace() for c in key) or not key.isprintable():
        return None, KeyStatus.INVALID
    return key, KeyStatus.OK


def redact(text: str, key: Optional[str]) -> str:
    """Sağlayıcıdan gelen hata metni anahtarı yansıtırsa gizler."""
    return text.replace(key, "[gizli]") if key and text else text
