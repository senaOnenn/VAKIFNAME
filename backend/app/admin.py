"""Yönetici tanımı: oturum açmış ve e-postası `VAKIFNAME_ADMIN_EMAILS` (virgülle ayrılmış) listesinde olan hesap."""

import os
from typing import Optional


def admin_emails() -> set[str]:
    return {e.strip().lower() for e in os.environ.get("VAKIFNAME_ADMIN_EMAILS", "").split(",") if e.strip()}


def is_admin(user: Optional[dict]) -> bool:
    return bool(user and user.get("email") and str(user["email"]).lower() in admin_emails())
