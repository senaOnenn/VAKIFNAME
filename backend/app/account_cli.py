"""Hazır hesap (demo yedeği, jüri): e-postası doğrulanmış bir e-posta+parola hesabı açar ya da parolasını yeniler.

Google ile giriş internetsiz çalışmaz; salonda bağlantı giderse bu hesapla girilir. Parola komut satırına yazılmaz
(kabuk geçmişine düşmesin): gizli sorulur ya da standart girdiden okunur.

    set -a && . ./.env && set +a
    .venv/bin/python -m app.account_cli --email juri@ornek.org --name "Jüri"            # yeni hesap
    .venv/bin/python -m app.account_cli --email juri@ornek.org --reset                  # parolayı yenile
"""

import argparse
import getpass
import os
import sys
from pathlib import Path
from typing import Optional

from .accounts import AccountStore, EmailTaken


def ensure_account(store: AccountStore, email: str, password: str, name: Optional[str] = None, reset: bool = False) -> str:
    """Hesap yoksa açar ve doğrulanmış sayar; `reset` ile var olanın parolasını yeniler (açık oturumları kapanır)."""
    if len(password) < 8:
        raise ValueError("Parola en az 8 karakter olmalı.")
    user = store.get_user_by_email(email)
    if user is None:
        user = store.create_user(email, password, name)
        store.mark_email_verified(user["id"])
        return "açıldı"
    if not reset:
        raise EmailTaken(email)
    store.reset_password(store.issue_email_token(user["id"], "reset"), password)
    return "parola yenilendi"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--email", required=True)
    ap.add_argument("--name")
    ap.add_argument("--reset", action="store_true", help="hesap varsa parolasını yenile")
    a = ap.parse_args(argv)
    db = os.environ.get("VAKIFNAME_ACCOUNTS_DB")
    if not db:
        print("VAKIFNAME_ACCOUNTS_DB tanımlı değil (önce .env yükleyin).", file=sys.stderr)
        return 2
    password = getpass.getpass("Parola: ") if sys.stdin.isatty() else sys.stdin.readline().rstrip("\n")
    store = AccountStore(Path(db))
    try:
        result = ensure_account(store, a.email, password, a.name, a.reset)
    except EmailTaken:
        print("Bu e-postayla hesap zaten var; parolayı yenilemek için --reset.", file=sys.stderr)
        return 1
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1
    finally:
        store.close()
    print(f"{a.email}: {result} (e-posta doğrulanmış).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
