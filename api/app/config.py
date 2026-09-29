from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    app_version: str = "0.1.0"
    callmissed_api_key: str = ""
    callmissed_base_url: str = "https://api.callmissed.com/v1"
    chat_model: str = "sarvam-105b-conversations"
    image_model: str = "sdxl-lightning"
    voice_language: str = "en-IN"
    voice_name: str = "shubh"
    voice_max_duration_seconds: int = Field(default=300, ge=30, le=3600)
    allowed_origins: str = "http://localhost:5173,http://localhost:8080"
    public_app_url: str = "http://localhost:8080"
    request_timeout_seconds: float = Field(default=45, ge=3, le=180)
    image_timeout_seconds: float = Field(default=120, ge=10, le=300)
    rate_chat_per_minute: int = Field(default=12, ge=1)
    rate_image_per_minute: int = Field(default=3, ge=1)
    rate_voice_per_minute: int = Field(default=2, ge=1)
    upstream_concurrency: int = Field(default=20, ge=1, le=100)
    log_level: str = "INFO"

    @model_validator(mode="after")
    def validate_production(self) -> "Settings":
        if self.app_env == "production":
            if not self.callmissed_api_key or self.callmissed_api_key.startswith("replace-"):
                raise ValueError("CALLMISSED_API_KEY is required in production")
            if not self.public_app_url.startswith("https://"):
                raise ValueError("PUBLIC_APP_URL must use HTTPS in production")
            if self.public_app_url not in self.origins or any(
                not origin.startswith("https://") for origin in self.origins
            ):
                raise ValueError("Production origins must include the HTTPS public URL only")
            if "*" in self.allowed_origins:
                raise ValueError("Wildcard CORS is forbidden in production")
            if not self.callmissed_base_url.startswith("https://"):
                raise ValueError("CallMissed base URL must use HTTPS in production")
        return self

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
