"""Hesap e-postaları: doğrulama ve parola yenileme bağlantısı.

- Gönderim yolu `VAKIFNAME_MAIL_BACKEND` ile seçilir: `off` (varsayılan; e-posta gönderilmez), `file` (yalnızca geliştirme:
  her e-posta `VAKIFNAME_MAIL_DIR` altına 0600 izinli bir `.eml` dosyası olarak yazılır) veya `smtp`.
- Bağlantı `VAKIFNAME_PUBLIC_BASE_URL` üzerine kurulur ve belirteç adresin **parça** (`#t=`) kısmında taşınır: tarayıcı
  parçayı sunucuya, sunucu loglarına ve `Referer` başlığına göndermez. Arayüz okur okumaz adres çubuğundan siler.
- Belirteç ve bağlantı loglanmaz. Gönderim hatası yalnızca hata türüyle yazılır.
- Kayıt formundaki ad e-postaya yazılmaz: başkasının adresiyle kayıt olan kişi, alıcının göreceği metne söz ekleyemesin.
"""

import html
import logging
import os
import smtplib
import ssl
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path
from typing import Optional, Protocol

log = logging.getLogger("vakifname.mail")

DEFAULT_BASE_URL = "http://localhost:5173"
BACKENDS = ("off", "file", "smtp")


class MailConfigError(RuntimeError):
    pass


class Mailer(Protocol):
    name: str

    def send(self, to: str, subject: str, text: str, html_body: str) -> None: ...


def _message(sender: str, to: str, subject: str, text: str, html_body: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, to, subject
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain=sender.rsplit("@", 1)[-1].strip("> ") or None)
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    return msg


class OffMailer:
    name = "off"

    def send(self, to: str, subject: str, text: str, html_body: str) -> None:
        log.info("E-posta gönderimi kapalı (VAKIFNAME_MAIL_BACKEND=off); hesap e-postası gönderilmedi.")


class FileMailer:
    """Geliştirme için: e-postayı göndermek yerine dosyaya yazar. Canlıda kullanılmaz."""

    name = "file"

    def __init__(self, directory: Path, sender: str):
        self.directory, self.sender = Path(directory), sender

    def send(self, to: str, subject: str, text: str, html_body: str) -> None:
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        path = self.directory / f"{stamp}-{uuid.uuid4().hex[:8]}.eml"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(bytes(_message(self.sender, to, subject, text, html_body)))


class SmtpMailer:
    name = "smtp"

    def __init__(self, host: str, port: int, security: str, user: Optional[str], password: Optional[str], sender: str,
                 timeout_s: float = 15.0):
        self.host, self.port, self.security = host, port, security
        self.user, self.password, self.sender, self.timeout_s = user, password, sender, timeout_s

    def send(self, to: str, subject: str, text: str, html_body: str) -> None:
        context = ssl.create_default_context()
        msg = _message(self.sender, to, subject, text, html_body)
        if self.security == "ssl":
            server = smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout_s, context=context)
        else:
            server = smtplib.SMTP(self.host, self.port, timeout=self.timeout_s)
        with server:
            if self.security == "starttls":
                server.starttls(context=context)
            if self.user:
                server.login(self.user, self.password or "")
            server.send_message(msg)


def _smtp_password() -> Optional[str]:
    path = os.environ.get("VAKIFNAME_SMTP_PASSWORD_FILE", "").strip()
    if path:
        return Path(path).read_text(encoding="utf-8").strip()
    return os.environ.get("VAKIFNAME_SMTP_PASSWORD") or None


def mailer_from_env() -> Mailer:
    """Geçersiz yapılandırma açılışta `MailConfigError` verir; sessizce başka yola düşülmez."""
    backend = os.environ.get("VAKIFNAME_MAIL_BACKEND", "off").strip().lower() or "off"
    if backend not in BACKENDS:
        raise MailConfigError(f"VAKIFNAME_MAIL_BACKEND={backend}: geçerli değerler {', '.join(BACKENDS)}")
    if backend == "off":
        return OffMailer()
    sender = os.environ.get("VAKIFNAME_MAIL_FROM", "").strip()
    if backend == "file":
        return FileMailer(Path(os.environ.get("VAKIFNAME_MAIL_DIR", "./local-mail")), sender or "VAKIFNAME <noreply@localhost>")
    host = os.environ.get("VAKIFNAME_SMTP_HOST", "").strip()
    security = os.environ.get("VAKIFNAME_SMTP_SECURITY", "starttls").strip().lower()
    if not host or not sender:
        raise MailConfigError("VAKIFNAME_MAIL_BACKEND=smtp için VAKIFNAME_SMTP_HOST ve VAKIFNAME_MAIL_FROM gerekli.")
    if security not in ("starttls", "ssl"):
        raise MailConfigError(f"VAKIFNAME_SMTP_SECURITY={security}: geçerli değerler starttls, ssl")
    port = int(os.environ.get("VAKIFNAME_SMTP_PORT", "465" if security == "ssl" else "587"))
    return SmtpMailer(host, port, security, os.environ.get("VAKIFNAME_SMTP_USER", "").strip() or None, _smtp_password(),
                      sender)


def public_base_url() -> str:
    return (os.environ.get("VAKIFNAME_PUBLIC_BASE_URL", "").strip() or DEFAULT_BASE_URL).rstrip("/")


# --- E-posta metinleri --------------------------------------------------------------------------------------------

def _html(before: list[str], link: str, button: str, after: list[str]) -> str:
    body = "".join(f"<p>{html.escape(p)}</p>" for p in before)
    rest = "".join(f"<p>{html.escape(p)}</p>" for p in after)
    href = html.escape(link, quote=True)
    return ("<!doctype html><html lang=\"tr\"><body style=\"font-family:Georgia,serif;line-height:1.6;max-width:560px\">"
            f"{body}<p><a href=\"{href}\">{html.escape(button)}</a></p>"
            f"<p style=\"font-size:13px\">Bağlantı açılmazsa bu adresi tarayıcınıza yapıştırın:<br>{html.escape(link)}</p>"
            f"{rest}<p>VAKIFNAME</p></body></html>")


def verification_mail(base_url: str, token: str, ttl_hours: int) -> tuple[str, str, str]:
    link = f"{base_url}/dogrula#t={token}"
    intro = "VAKIFNAME hesabınızı tamamlamak için bu e-posta adresinin size ait olduğunu doğrulamanız gerekiyor."
    note = (f"Bağlantı {ttl_hours} saat geçerlidir ve yalnızca bir kez kullanılabilir. Bu hesabı siz açmadıysanız "
            "bu e-postayı yok sayabilirsiniz.")
    text = f"Merhaba,\n\n{intro}\n\n{link}\n\n{note}\n\nVAKIFNAME\n"
    return "VAKIFNAME: e-posta adresinizi doğrulayın", text, _html(["Merhaba,", intro], link, "E-postamı doğrula", [note])


def reset_mail(base_url: str, token: str, ttl_minutes: int) -> tuple[str, str, str]:
    link = f"{base_url}/sifre-yenile#t={token}"
    intro = "VAKIFNAME hesabınız için parola yenileme isteği aldık. Yeni parolanızı aşağıdaki bağlantıdan belirleyin."
    note = (f"Bağlantı {ttl_minutes} dakika geçerlidir ve yalnızca bir kez kullanılabilir. İsteği siz yapmadıysanız "
            "bu e-postayı yok sayın; parolanız değişmez.")
    text = f"Merhaba,\n\n{intro}\n\n{link}\n\n{note}\n\nVAKIFNAME\n"
    return "VAKIFNAME: parola yenileme", text, _html(["Merhaba,", intro], link, "Yeni parola belirle", [note])


def deliver(mailer: Mailer, to: str, mail: tuple[str, str, str]) -> None:
    """Arka plan görevinden çağrılır; hata isteği düşürmez, yalnızca türüyle loglanır (adres ve bağlantı yazılmaz)."""
    subject, text, html_body = mail
    try:
        mailer.send(to, subject, text, html_body)
    except Exception as e:  # noqa: BLE001 — arka plan görevi: hiçbir hata kullanıcıya veya loga içerik sızdırmamalı
        log.warning("Hesap e-postası gönderilemedi (%s, %s).", mailer.name, type(e).__name__)
