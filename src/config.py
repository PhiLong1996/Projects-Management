from functools import lru_cache
from pathlib import Path
from typing import Set
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

    model_config = SettingsConfigDict(
        env_file=ENV_FILE_PATH, env_file_encoding="utf-8", extra="ignore"
    )


@lru_cache
def get_settings():
    return Settings()
