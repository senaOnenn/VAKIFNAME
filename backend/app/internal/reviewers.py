"""İncelemeci hesapları (yalnızca sunucuda, komut satırından).

Her gerçek kişi için ayrı hesap açılır; kişisel kimlik bilgisi yalnızca bir kez ekrana yazılır ve veritabanında özet
olarak saklanır. Hesaplar silinmez, devre dışı bırakılır; her işlem denetim günlüğüne yazılır.

    python -m app.internal.reviewers add --id ayse.editor --name "Ayşe Yılmaz" --role editor
    python -m app.internal.reviewers list
    python -m app.internal.reviewers deactivate --id ayse.editor
    python -m app.internal.reviewers verify-audit
"""

import argparse
import getpass
import json
import os

from . import config
from .review_store import ROLES, ReviewStore


def main(argv=None):
    parser = argparse.ArgumentParser(description="VAKIFNAME incelemeci hesapları")
    sub = parser.add_subparsers(dest="cmd", required=True)
    add = sub.add_parser("add", help="Yeni incelemeci hesabı aç")
    add.add_argument("--id", required=True)
    add.add_argument("--name", required=True, help="Kararlarda görünecek gerçek ad")
    add.add_argument("--role", required=True, action="append", choices=ROLES)
    sub.add_parser("list", help="Hesapları listele")
    for name in ("deactivate", "activate"):
        p = sub.add_parser(name)
        p.add_argument("--id", required=True)
    sub.add_parser("verify-audit", help="Denetim günlüğü zincirini doğrula")
    args = parser.parse_args(argv)

    store = ReviewStore(config.data_dir_from_env() / config.REVIEW_DB_FILE)
    actor = f"cli:{os.environ.get('SUDO_USER') or getpass.getuser()}"
    if args.cmd == "add":
        credential = store.add_reviewer(args.id, args.name, tuple(args.role), created_by=actor)
        print(f"Hesap açıldı: {args.id} ({', '.join(sorted(set(args.role)))})")
        print("Kişisel kimlik bilgisi (yalnızca şimdi gösterilir; yalnızca hesap sahibine güvenli kanaldan iletin):")
        print(credential)
    elif args.cmd == "list":
        for r in store.reviewers():
            print(f"{r.reviewer_id}\t{r.display_name}\t{','.join(r.roles)}\t{'etkin' if r.active else 'devre dışı'}")
    elif args.cmd in ("deactivate", "activate"):
        store.set_active(args.id, args.cmd == "activate", changed_by=actor)
        print(f"{args.id}: {'etkin' if args.cmd == 'activate' else 'devre dışı'}")
    else:
        print(json.dumps(store.verify_audit_chain(), ensure_ascii=False))


if __name__ == "__main__":
    main()
