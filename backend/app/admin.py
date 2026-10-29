"""Yönetici tanımı: oturum açmış, e-postası `VAKIFNAME_ADMIN_EMAILS` (virgülle ayrılmış) listesinde olan **ve e-postası
doğrulanmış** hesap. Doğrulama şarttır: aksi halde yöneticinin adresiyle parolalı kayıt açan herkes yönetici olurdu."""

import os
from typing import Optional


def admin_emails() -> set[str]:
    return {e.strip().lower() for e in os.environ.get("VAKIFNAME_ADMIN_EMAILS", "").split(",") if e.strip()}


def is_admin(user: Optional[dict]) -> bool:
    return bool(user and user.get("email") and user.get("email_verified_at")
                and str(user["email"]).lower() in admin_emails())
