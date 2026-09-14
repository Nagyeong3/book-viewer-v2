from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Book Viewer V2"
    app_env: Literal["development", "test", "production"] = "development"
    app_host: str = "0.0.0.0"
    app_port: int = Field(default=9056, ge=1, le=65535)
    log_level: str = "INFO"
    enable_api_docs: bool = False

    database_url: str | None = None
    database_min_pool_size: int = Field(default=1, ge=1, le=50)
    database_max_pool_size: int = Field(default=10, ge=1, le=100)
    database_command_timeout: float = Field(default=30.0, gt=0, le=300)

    elasticsearch_url: str | None = None
    elasticsearch_username: str | None = None
    elasticsearch_password: str | None = None
    elasticsearch_timeout: float = Field(default=30.0, gt=0, le=300)
    es_document_alias: str = "rag-documents"
    es_maintenance_alias: str = "rag-maintenance"

    embedding_provider: str = "vllm"
    embedding_base_url: str | None = None
    embedding_model: str = "bge-m3"
    embedding_dimensions: int = Field(default=1024, ge=1)

    llm_provider: str = "litellm"
    litellm_base_url: str | None = None
    litellm_api_key: str | None = None
    llm_model: str = "gpt-oss-120b-vllm"

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, value: str) -> str:
        normalized = value.upper()
        if normalized not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}:
            raise ValueError("LOG_LEVEL must be one of CRITICAL, ERROR, WARNING, INFO, DEBUG")
        return normalized

    @field_validator(
        "database_url",
        "elasticsearch_url",
        "elasticsearch_username",
        "elasticsearch_password",
        "embedding_base_url",
        "litellm_base_url",
        "litellm_api_key",
    )
    @classmethod
    def normalize_optional_string(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("database_max_pool_size")
    @classmethod
    def validate_pool_sizes(cls, value: int, info):
        min_size = info.data.get("database_min_pool_size", 1)
        if value < min_size:
            raise ValueError("DATABASE_MAX_POOL_SIZE must be >= DATABASE_MIN_POOL_SIZE")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
