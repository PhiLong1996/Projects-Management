from functools import lru_cache
from pathlib import Path
from typing import List, Set
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE_PATH = BASE_DIR / ".env"


class Settings(BaseSettings):
    app_name: str = "Task Management API"
    database_url: str = "sqlite+aiosqlite:///./task_management.db"
    db_echo: bool = False
    secret_key: str = "supersecretkey"

    admin_email: str = "admin@example.com"
    admin_password: str = "Admin@123"

    # --- Outbound email (forgot-password) ---
    # Left blank by default: with no SMTP host/user/password configured,
    # src/core/email.py logs the email instead of sending it, so the
    # forgot-password flow works out of the box for local dev/testing.
    # Set these in .env to send real emails once you have SMTP credentials
    # (Gmail app password, SendGrid, Mailtrap, etc.) — no code changes needed.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "admin@example.com"  # defaults to smtp_user if unset
    smtp_use_tls: bool = True
    # Used to build the password-reset link emailed to the user
    # (<frontend_url>/reset-password?token=...). Point this at wherever the
    # frontend's reset-password page actually lives.
    frontend_url: str = "http://localhost:3000"

    # --- CORS ---
    # Comma-separated list of origins allowed to call this API from a
    # browser. Needed because the frontend/ Next.js app runs on its own
    # origin during local dev (`next dev` on :3000, or Nginx on :8080 under
    # the full docker-compose stack) — neither is this API's own origin.
    cors_origins: str = "http://localhost:3000,http://localhost:8080"

    # --- Realtime notification delivery (WebSocket + Redis pub/sub) ---
    # Redis is only the fan-out layer between app instances/workers — each
    # instance still pushes to its own locally-connected WebSocket clients.
    # If Redis is unreachable, notification creation still succeeds (it's
    # just DB rows); only the live push is skipped, with a warning logged
    # (see src/core/realtime.py) — same "never let delivery infra break the
    # core feature" pattern as the SMTP send in forgot-password.
    redis_url: str = "redis://localhost:6379/0"

    # --- Deadline check job ---
    # How often (seconds) the in-process background loop (see
    # src/jobs/check_deadlines.py's deadline_check_loop, started from
    # app.py's lifespan) re-scans tasks for DEADLINE_APPROACHING /
    # TASK_OVERDUE. Notifications are deduplicated via `deduplication_key`,
    # so a shorter interval just means events are noticed sooner — it does
    # not create duplicate notifications. Default: 900s (15 minutes).
    deadline_check_interval_seconds: int = 900

    max_file_size_bytes: int = 10 * 1024 * 1024

    allowed_mime_types: Set[str] = {
        "image/jpeg",
        "image/png",
        "image/gif",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
    }

    allowed_extensions: Set[str] = {
        ".jpg", ".jpeg", ".png", ".gif", ".pdf", ".doc", ".docx", ".txt",
    }

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    model_config = SettingsConfigDict(
        env_file=ENV_FILE_PATH, env_file_encoding="utf-8", extra="ignore"
    )


@lru_cache
def get_settings():
    return Settings()
