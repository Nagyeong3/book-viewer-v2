from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Book Viewer V2"
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 9056
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
