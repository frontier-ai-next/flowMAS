"""Service configuration."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    data_dir: str = str(Path(__file__).resolve().parent.parent / "data")
    api_key: str = ""
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    model_config = SettingsConfigDict(env_prefix="GMAS_OBSERVABILITY_", extra="ignore")


settings = Settings()

