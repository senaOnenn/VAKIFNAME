"""Hazır hesap komutu (demo yedeği): doğrulanmış e-posta+parola hesabı açar, istenirse parolayı yeniler."""

import subprocess
import sys
from pathlib import Path

import pytest

from app.account_cli import ensure_account
from app.accounts import AccountStore, EmailTaken


def test_creates_verified_account_and_resets_password(tmp_path):
    store = AccountStore(tmp_path / "a.sqlite3")
    assert ensure_account(store, "Juri@Ornek.org", "gizli-parola-1", "Jüri") == "açıldı"
    user = store.authenticate("juri@ornek.org", "gizli-parola-1")
    assert user and user["email_verified_at"] and user["display_name"] == "Jüri"
    token = store.create_session(user["id"], "password")
    with pytest.raises(EmailTaken):
        ensure_account(store, "juri@ornek.org", "baska-parola-2")
    assert ensure_account(store, "juri@ornek.org", "baska-parola-2", reset=True) == "parola yenilendi"
    assert store.authenticate("juri@ornek.org", "gizli-parola-1") is None
    assert store.authenticate("juri@ornek.org", "baska-parola-2")
    assert store.session_user(token) is None  # eski oturumlar kapanır
    with pytest.raises(ValueError):
        ensure_account(store, "kisa@ornek.org", "kisa")


def test_command_reads_password_from_stdin_not_argv(tmp_path):
    db = tmp_path / "a.sqlite3"
    run = lambda *args: subprocess.run([sys.executable, "-m", "app.account_cli", *args], input="gizli-parola-1\n",
                                       capture_output=True, text=True, cwd=Path(__file__).resolve().parents[1],
                                       env={"VAKIFNAME_ACCOUNTS_DB": str(db), "PATH": "/usr/bin:/bin"})
    r = run("--email", "juri@ornek.org", "--name", "Jüri")
    assert r.returncode == 0 and "açıldı" in r.stdout and "gizli" not in r.stdout
    assert run("--email", "juri@ornek.org").returncode == 1
    assert AccountStore(db).authenticate("juri@ornek.org", "gizli-parola-1")
