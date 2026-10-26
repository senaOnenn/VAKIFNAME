"""API anahtarını yalnızca dosyadan okur; ortam değişkeni, komut satırı veya kod içi anahtar kabul edilmez.

Arama sırası:
1. `$CREDENTIALS_DIRECTORY/openrouter_api_key` (systemd `LoadCredential=`; servis hesabına özel, bellekte tutulur).
2. `VAKIFNAME_OPENROUTER_KEY_FILE` ile gösterilen dosya (varsayılan `/etc/vakifname/secrets/openrouter_api_key`).

Dosya grup veya diğer kullanıcılar tarafından okunabiliyorsa ya da sahibi root veya servisi çalıştıran hesap değilse
anahtar reddedilir. Anahtar hiçbir zaman loglanmaz; hata
mesajları yalnızca durum kodunu taşır.
"""

import os
import stat
from pathlib import Path
from typing import Optional

DEFAULT_KEY_FILE = Path("/etc/vakifname/secrets/openrouter_api_key")
CREDENTIAL_NAME = "openrouter_api_key"
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


def load_key(path: Optional[Path] = None) -> tuple[Optional[str], str]:
    """(anahtar, durum). Anahtar yoksa veya güvensizse (None, durum) döner; istisna fırlatmaz."""
    path = Path(path) if path else key_path()
    try:
        st = path.stat()
    except OSError:
        return None, KeyStatus.MISSING
    if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_KEY_BYTES:
        return None, KeyStatus.INVALID
    if st.st_mode & (stat.S_IRWXG | stat.S_IRWXO) or st.st_uid not in (0, os.geteuid()):
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
