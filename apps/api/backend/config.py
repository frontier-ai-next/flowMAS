"""Application settings loaded from environment variables."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Web-UI backend configuration."""

    src_path: str = str(
        Path(__file__).resolve().parent.parent.parent.parent / "vendor" / "gmas" / "src"
    )

    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    data_dir: str = str(Path(__file__).resolve().parent.parent / "data")

    # Anonymous session cookie (per-browser workspace isolation).
    session_cookie_secure: bool = False
    session_cookie_max_age: int = 60 * 60 * 24 * 365  # 1 year

    # Optional standalone observability product. Disabled by default so the
    # platform remains fully functional without the extra service.
    observability_enabled: bool = False
    observability_endpoint: str = "http://localhost:8100"
    observability_project: str = "gmas-demo"
    observability_environment: str = "development"
    observability_api_key: str = ""
    observability_timeout_seconds: float = 2.0
    observability_capture_content: bool = True

    model_config = SettingsConfigDict(env_prefix="GMAS_", extra="ignore")


settings = Settings()
