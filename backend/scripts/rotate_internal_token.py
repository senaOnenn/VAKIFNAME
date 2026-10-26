"""8765 dahili API erişim anahtarının rotasyonu (yalnızca yetkili yönetici onayıyla; anahtar hiçbir zaman yazdırılmaz).

Kullanım (root, backend klasöründe):
  python3 -I scripts/rotate_internal_token.py           # yalnızca ön denetim; hiçbir şey değişmez
  python3 -I scripts/rotate_internal_token.py --yes     # rotasyonu yapar

Adımlar (`--yes`):
1. Ön denetim: 8765'i dinleyen süreç `app.internal.server` mı, anahtar dosyası 600/root mu, eski anahtar çalışıyor mu.
2. İnceleme veritabanının (editör kararları, denetim kayıtları) SQLite çevrimiçi yedeği alınır; tablo satır sayıları kaydedilir.
3. Yeni anahtar üretilir ve dosyaya atomik olarak yazılır (izin 600). Eski anahtar yalnızca geri alma için bellekte tutulur.
4. Süreç SIGTERM ile düzgünce durdurulur ve aynı komutla, aynı çalışma klasöründe yeniden başlatılır. Anahtar artık süreç
   ortamına konmaz (`VAKIFNAME_INTERNAL_TOKEN_FILE`); ortamdan Claude Code oturum değişkenleri de çıkarılır.
5. Doğrulama: yeni anahtar 200, eski anahtar 401, anahtarsız 401; eser sayısı ve inceleme veritabanı satır sayıları aynı.
6. Herhangi bir adım başarısız olursa eski anahtar dosyaya geri yazılır ve servis eski ortamıyla yeniden başlatılır.

Tarayıcıdaki inceleme oturumları bellekte tutulduğu için yeniden başlatmada kapanır; incelemeciler yeni anahtarla tekrar
girer. Yeni anahtar yöneticiye bu araçla gösterilmez; gerekirse sunucuda `cat` ile, ekran paylaşımı olmadan okunur.
"""

import argparse
import json
import os
import re
import secrets
import signal
import sqlite3
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
TOKEN_FILE = Path("/var/lib/vakifname-internal/secrets/internal_token")
ARCHIVE_DIR = Path("/var/lib/vakifname-internal/archives")
KEEP_ENV = {"PATH", "HOME", "LANG", "USER", "LOGNAME", "SHELL"}
START_TIMEOUT_S = 240


def say(msg: str):
    print(msg, flush=True)


def fail(msg: str):
    say(f"HATA: {msg}")
    raise SystemExit(1)


def status_code(path: str, token: str | None) -> int:
    req = urllib.request.Request(BASE + path, headers={"X-Internal-Token": token} if token else {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError):
        return 0


def get_json(path: str, token: str):
    req = urllib.request.Request(BASE + path, headers={"X-Internal-Token": token})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def find_process() -> dict:
    out = subprocess.run(["ss", "-ltnpH", f"sport = :{PORT}"], capture_output=True, text=True, check=True).stdout
    pids = set(re.findall(r"pid=(\d+)", out))
    if len(pids) != 1:
        fail(f"{PORT} portunu dinleyen tek süreç bulunamadı ({len(pids)}).")
    pid = int(pids.pop())
    proc = Path(f"/proc/{pid}")
    cmd = [a.decode() for a in (proc / "cmdline").read_bytes().split(b"\0") if a]
    if "app.internal.server" not in cmd:
        fail(f"{PORT} portundaki süreç dahili sunucu değil.")
    env = dict(e.decode().split("=", 1) for e in (proc / "environ").read_bytes().split(b"\0") if b"=" in e)
    fds = [os.readlink(p) for p in (proc / "fd").iterdir() if p.is_symlink()]
    log = next((f for f in fds if f.endswith(".log")), None)
    db = next((f for f in fds if f.endswith("review.sqlite3")), None)
    return {"pid": pid, "cmd": cmd, "cwd": os.readlink(proc / "cwd"), "env": env, "log": log, "db": db}


def read_token_file() -> str:
    st = TOKEN_FILE.stat()
    if st.st_uid != 0 or st.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        fail("Anahtar dosyası root'a ait ve 600 izinli olmalı.")
    return TOKEN_FILE.read_text(encoding="utf-8").strip()


def write_token_file(token: str):
    tmp = TOKEN_FILE.with_name(f".{TOKEN_FILE.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(token + "\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, TOKEN_FILE)


def table_counts(db: str) -> dict:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        return {t: con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
    finally:
        con.close()


def backup_db(db: str) -> Path:
    ARCHIVE_DIR.mkdir(mode=0o700, exist_ok=True)
    dest = ARCHIVE_DIR / f"review-before-token-rotation-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.sqlite3"
    src, dst = sqlite3.connect(f"file:{db}?mode=ro", uri=True), sqlite3.connect(dest)
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    os.chmod(dest, 0o600)
    check = sqlite3.connect(f"file:{dest}?mode=ro", uri=True)
    try:
        integrity = check.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        check.close()
    if integrity != "ok":
        fail(f"Yedek bütünlük denetimi başarısız: {integrity}")
    if table_counts(str(dest)) != table_counts(db):
        fail("Yedek doğrulanamadı (satır sayıları farklı).")
    return dest


def env_has_token(pid: int) -> bool:
    """Süreç ortamında tam olarak `VAKIFNAME_INTERNAL_TOKEN=` girdisi var mı (`..._TOKEN_FILE` sayılmaz)."""
    entries = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
    return any(e.startswith(b"VAKIFNAME_INTERNAL_TOKEN=") for e in entries)


def stop(pid: int):
    os.kill(pid, signal.SIGTERM)
    for _ in range(60):
        if not Path(f"/proc/{pid}").exists():
            return
        time.sleep(0.5)
    say("Süreç 30 sn içinde durmadı; SIGKILL gönderiliyor.")
    os.kill(pid, signal.SIGKILL)
    time.sleep(1)


def start(p: dict, env: dict) -> subprocess.Popen:
    log = open(p["log"] or os.devnull, "ab")
    return subprocess.Popen(p["cmd"], cwd=p["cwd"], env=env, stdin=subprocess.DEVNULL, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)


def wait_ready(proc: subprocess.Popen, token: str) -> bool:
    deadline = time.monotonic() + START_TIMEOUT_S
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return False
        if status_code("/internal/status", token) == 200:
            return True
        time.sleep(2)
    return False


def main():
    global PORT, BASE, TOKEN_FILE, ARCHIVE_DIR
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="rotasyonu yap (yetkili yönetici onayıyla)")
    # Yalnızca prova için (sahte sunucuyla); gerçek rotasyonda varsayılanlar kullanılır.
    ap.add_argument("--port", type=int, default=PORT, help=argparse.SUPPRESS)
    ap.add_argument("--token-file", type=Path, default=TOKEN_FILE, help=argparse.SUPPRESS)
    ap.add_argument("--archive-dir", type=Path, default=ARCHIVE_DIR, help=argparse.SUPPRESS)
    args = ap.parse_args()
    PORT, TOKEN_FILE, ARCHIVE_DIR = args.port, args.token_file, args.archive_dir
    BASE = f"http://127.0.0.1:{PORT}"
    if os.geteuid() != 0:
        fail("root olarak çalıştırılmalı.")

    p = find_process()
    old = read_token_file()
    say(f"Süreç: pid {p['pid']} · çalışma klasörü {p['cwd']} · log {p['log']} · inceleme DB {p['db']}")
    say(f"Anahtar dosyası: {TOKEN_FILE} (600, root) · uzunluk {len(old)}")
    in_env = "VAKIFNAME_INTERNAL_TOKEN" in p["env"]
    say(f"Anahtar süreç ortamında: {'evet' if in_env else 'hayır'}"
        + (f" · dosyayla aynı: {'evet' if secrets.compare_digest(p['env']['VAKIFNAME_INTERNAL_TOKEN'], old) else 'HAYIR'}" if in_env else ""))
    codes = {"eski anahtar": status_code("/internal/status", old), "anahtarsız": status_code("/internal/status", None)}
    say(f"Erişim: {codes}")
    if codes["eski anahtar"] != 200 or codes["anahtarsız"] != 401:
        fail("Beklenen erişim durumu yok (eski anahtar 200, anahtarsız 401 olmalı).")
    if not p["db"]:
        fail("İnceleme veritabanı bulunamadı.")
    before = table_counts(p["db"])
    monuments_before = len(get_json("/internal/catalog/monuments", old))
    say(f"İnceleme DB satırları: {before} · dahili katalog eser sayısı: {monuments_before}")
    if not args.yes:
        say("Ön denetim tamam. Rotasyon için yetkili yönetici onayıyla --yes ekleyin.")
        return 0

    backup = backup_db(p["db"])
    say(f"Yedek: {backup} (600, satır sayıları doğrulandı)")
    new = secrets.token_urlsafe(48)
    old_env = p["env"]
    new_env = {k: v for k, v in old_env.items() if k in KEEP_ENV or k.startswith("VAKIFNAME_")}
    new_env.pop("VAKIFNAME_INTERNAL_TOKEN", None)
    new_env["VAKIFNAME_INTERNAL_TOKEN_FILE"] = str(TOKEN_FILE)

    proc, ok = None, False
    try:
        write_token_file(new)
        say("Yeni anahtar dosyaya yazıldı. Servis yeniden başlatılıyor…")
        stop(p["pid"])
        proc = start(p, new_env)
        ok = wait_ready(proc, new)
        say(f"Yeni süreç hazır: {'evet' if ok else 'HAYIR'}")
        if ok:
            checks = {"yeni anahtar": status_code("/internal/status", new),
                      "eski anahtar": status_code("/internal/status", old),
                      "anahtarsız": status_code("/internal/status", None)}
            after = table_counts(p["db"])
            monuments_after = len(get_json("/internal/catalog/monuments", new))
            token_in_env = env_has_token(proc.pid)
            say(f"Doğrulama: {checks} · DB satırları aynı: {after == before} {after} · eser sayısı: {monuments_after}")
            say(f"Yeni süreç: pid {proc.pid} · anahtar ortamda: {'EVET' if token_in_env else 'hayır'}")
            ok = (checks == {"yeni anahtar": 200, "eski anahtar": 401, "anahtarsız": 401} and after == before
                  and monuments_after == monuments_before and not token_in_env)
    except Exception as e:  # noqa: BLE001 — her hata geri almaya gider
        say(f"Rotasyon sırasında hata: {type(e).__name__}")
        ok = False
    if ok:
        say("Rotasyon tamamlandı. Eski anahtar geçersiz. İncelemeciler tarayıcıda yeni anahtarla yeniden giriş yapmalı.")
        return 0

    say("Doğrulama başarısız; eski anahtara geri dönülüyor…")
    if proc is not None and proc.poll() is None:
        stop(proc.pid)
    write_token_file(old)
    back = start(p, old_env)
    restored = wait_ready(back, old) and status_code("/internal/status", new) == 401
    say(f"Geri alma: {'servis eski anahtarla çalışıyor' if restored else 'SERVİS AYAĞA KALKMADI — log dosyasını inceleyin'}"
        f" (pid {back.pid}). Yedek: {backup}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
