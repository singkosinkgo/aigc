from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = "local"
    app_name: str = "LeapAI AIGC Studio"
    api_host: str = "127.0.0.1"
    api_port: int = 8001
    storage_mode: str = "database"
    database_url: str = ""
    local_data_dir: str = "data"
    default_user_nickname: str = "伦琴"
    default_user_password: str
    default_user_avatar_url: str | None = None
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    model_request_timeout: int = 300
    upload_dir: str = "uploads"
    public_upload_base_url: str = "http://127.0.0.1:8001/uploads"
    reload: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
