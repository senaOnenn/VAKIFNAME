"""Anahtar dosyasının yalnızca güvenlik durumunu yazar: ok | missing | insecure | invalid. İÇERİĞİ OKUMAZ.

Denetim, backend'in kullandığı kurallarla aynıdır (app/guide/secret.py): düzenli dosya, boş değil ve en çok 512 bayt;
Windows'ta erişim listesi (yalnızca geçerli kullanıcı/SYSTEM/Administrators), Linux'ta izin 600 ve güvenilir sahip.
Biçim denetimi (sk-or-…) içerik gerektirdiği için burada yapılmaz; kurulum betiği yazmadan önce yapar.

    .venv\\Scripts\\python.exe scripts\\secret_status.py openrouter
    .venv\\Scripts\\python.exe scripts\\secret_status.py evren
"""

import os
import stat
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.guide.secret import MAX_KEY_BYTES, _private, evren_key_path, key_path  # noqa: E402


def _openrouter_path() -> Path:
    """Backend'le aynı kural; yalnızca Windows'ta değişken ayarlı değilse kurulum betiğinin yazdığı yol denetlenir
    (backend için VAKIFNAME_OPENROUTER_KEY_FILE bu yola ayarlanmalıdır)."""
    if os.name == "nt" and not os.environ.get("VAKIFNAME_OPENROUTER_KEY_FILE") and not os.environ.get("CREDENTIALS_DIRECTORY"):
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "vakifname" / "secrets" / "openrouter_api_key"
    return key_path()


PATHS = {"openrouter": _openrouter_path, "evren": evren_key_path}


def status(path: Path) -> str:
    try:
        st = path.stat()
    except OSError:
        return "missing"
    if not stat.S_ISREG(st.st_mode) or st.st_size == 0 or st.st_size > MAX_KEY_BYTES:
        return "invalid"
    return "ok" if _private(path, st) else "insecure"


def main(argv: list[str]) -> int:
    names = argv or ["openrouter"]
    for name in names:
        if name not in PATHS:
            print(f"bilinmeyen anahtar: {name} (geçerli: {', '.join(PATHS)})")
            return 2
        path = PATHS[name]()
        print(f"{name}: {status(path)}  ({path})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
