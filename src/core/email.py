"""Minimal outbound email helper, currently used by the forgot-password flow.

If SMTP isn't configured at all (no smtp_host in .env), send_email() logs
the message instead of sending it — a "dev fallback" that keeps the
forgot-password flow fully testable without any mail server running.

Once smtp_host is set, the exact same call sends a real email — either to
a self-hosted, no-auth dev relay like Mailpit/MailHog (leave smtp_user/
smtp_password blank; see docker-compose.yml's `mailpit` service), or to a
real provider that requires auth (Gmail app password, SendGrid, Mailtrap,
...) by also setting smtp_user/smtp_password. Nothing else needs to
change either way.
"""
import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from src.config import get_settings

logger = logging.getLogger("email")


def _send_sync(host: str, port: int, user: str, password: str, use_tls: bool, message: MIMEMultipart, to: str) -> None:
    """Blocking smtplib call — run via asyncio.to_thread so it doesn't stall the event loop."""
    with smtplib.SMTP(host, port, timeout=10) as server:
        if use_tls:
            server.starttls()
        # A self-hosted dev relay like Mailpit accepts mail with no
        # authentication at all — only attempt login when credentials were
        # actually provided, rather than requiring them unconditionally.
        if user and password:
            server.login(user, password)
        server.sendmail(message["From"], [to], message.as_string())


async def send_email(to: str, subject: str, body: str) -> None:
    settings = get_settings()

    if not settings.smtp_host:
        # Dev fallback: no SMTP server configured at all. Log (and print,
        # so it's visible in the uvicorn console during manual/local
        # testing) instead of silently doing nothing or raising.
        logger.info("DEV EMAIL (not sent — SMTP not configured) to=%s subject=%r", to, subject)
        print(
            "\n----- DEV EMAIL (not sent — SMTP not configured in .env) -----\n"
            f"To: {to}\nSubject: {subject}\n\n{body}\n"
            "----------------------------------------------------------------\n"
        )
        return

    message = MIMEMultipart()
    message["From"] = settings.smtp_from or settings.smtp_user or "noreply@example.com"
    message["To"] = to
    message["Subject"] = subject
    message.attach(MIMEText(body, "plain"))

    await asyncio.to_thread(
        _send_sync,
        settings.smtp_host,
        settings.smtp_port,
        settings.smtp_user,
        settings.smtp_password,
        settings.smtp_use_tls,
        message,
        to,
    )
