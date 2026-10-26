"""Tarayıcı testleri için yalıtılmış dahili inceleme ortamı.

Her çalıştırma boş bir çalışma dizininde **yeni** bir inceleme veritabanı, rastgele bir dahili erişim anahtarı ve
yalnızca test için bir incelemeci hesabı oluşturur; sonuçlar bu yüzden her çalıştırmada aynıdır. Gerçek inceleme
veritabanı (`VAKIFNAME_INTERNAL_DATA_DIR/review/`) hiçbir koşulda açılmaz; çalışma dizini veri dizininin içindeyse veya
boş değilse komut durur. Anahtar ve kimlik bilgisi yalnızca çalışma dizinine 0600 izinle yazılır, ekrana basılmaz.

    python scripts/e2e_review_env.py prepare /tmp/e2e-xyz
    python scripts/e2e_review_env.py serve /tmp/e2e-xyz --port 8766 [--min-review-seconds 5]
"""

import argparse
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.internal import config  # noqa: E402
from app.internal.review_store import ReviewStore  # noqa: E402

E2E_REVIEWER_ID = "e2e.editor"
E2E_REVIEWER_NAME = "Tarayıcı Testi Editörü (geçici DB)"


def _workdir(path: Path, data_dir: Path) -> Path:
    """Çalışma dizini gerçek dahili veri dizininde olamaz. Kurgusal veri dizini ise çalışma dizininin kendisi olabilir
    (`e2e_fictional_data.py`); o durumda veri ve geçici inceleme DB'si aynı geçici dizindedir."""
    path = path.resolve()
    protected = {config.DEFAULT_DATA_DIR.resolve()}
    if data_dir.resolve() != path:
        protected.add(data_dir.resolve())
    for p in protected:
        if path == p or p in path.parents:
            raise SystemExit("Çalışma dizini dahili veri dizininin içinde olamaz; gerçek inceleme veritabanı korunur.")
    return path


def _write_secret(path: Path, value: str):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(value)


def prepare(workdir: Path, data_dir: Path):
    workdir = _workdir(workdir, data_dir)
    workdir.mkdir(parents=True, exist_ok=True)
    if any(workdir.iterdir()):
        raise SystemExit(f"{workdir} boş değil; her çalıştırma yeni bir dizin kullanmalı.")
    store = ReviewStore(workdir / "review" / "review.sqlite3")
    credential = store.add_reviewer(E2E_REVIEWER_ID, E2E_REVIEWER_NAME, ("editor",), created_by="e2e")
    store.close()
    _write_secret(workdir / "token", secrets.token_urlsafe(32))
    _write_secret(workdir / "reviewer_credential", credential)
    print(f"Hazır: {workdir} (incelemeci {E2E_REVIEWER_ID})")


def serve(workdir: Path, data_dir: Path, port: int, min_review_seconds: float):
    import uvicorn

    from app.internal.server import create_internal_app

    workdir = _workdir(workdir, data_dir)
    review_db = workdir / "review" / "review.sqlite3"
    if not review_db.is_file():
        raise SystemExit("Önce 'prepare' çalıştırın.")
    app = create_internal_app(data_dir, (workdir / "token").read_text().strip(),
                              research_file=config.research_file_from_env(), review_db=review_db,
                              min_review_seconds=min_review_seconds)
    uvicorn.run(app, host="127.0.0.1", port=port, proxy_headers=False, forwarded_allow_ips="", log_level="warning")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("workdir", type=Path)
    s = sub.add_parser("serve")
    s.add_argument("workdir", type=Path)
    s.add_argument("--port", type=int, default=8766)
    s.add_argument("--min-review-seconds", type=float, default=5.0)
    args = parser.parse_args(argv)
    data_dir = config.data_dir_from_env()
    if args.cmd == "prepare":
        prepare(args.workdir, data_dir)
    else:
        if args.port == 8765:
            raise SystemExit("8765 kullanıcının dahili sunucusuna ayrılmıştır; test için başka port seçin.")
        serve(args.workdir, data_dir, args.port, args.min_review_seconds)


if __name__ == "__main__":
    main()
