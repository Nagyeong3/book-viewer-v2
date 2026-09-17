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
    cors_allowed_origins: str = "http://127.0.0.1:3000,http://localhost:3000"

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

    seaweedfs_master_url: str | None = None
    seaweedfs_filer_url: str | None = None

    embedding_provider: str = "vllm"
    embedding_base_url: str | None = None
    embedding_model: str = "bge-m3"
    embedding_api_key: str | None = None
    embedding_dimensions: int = Field(default=1024, ge=1)
    embedding_timeout: float = Field(default=60.0, gt=0, le=600)
    embedding_max_retries: int = Field(default=3, ge=1, le=10)
    embedding_retry_backoff_factor: float = Field(default=1.5, gt=0, le=60)

    retrieval_title_boost: float = Field(default=3.0, gt=0, le=20)
    retrieval_keyword_weight: float = Field(default=0.5, ge=0, le=1)
    retrieval_vector_weight: float = Field(default=0.5, ge=0, le=1)
    retrieval_candidate_multiplier: int = Field(default=4, ge=1, le=20)
    rag_top_k: int = Field(default=8, ge=1, le=50)
    rag_context_max_chars: int = Field(default=24000, ge=1000, le=200000)

    llm_provider: str = "litellm"
    litellm_base_url: str | None = None
    litellm_api_key: str | None = None
    llm_model: str = "gpt-oss120b"
    llm_timeout: float = Field(default=120.0, gt=0, le=1200)
    llm_max_retries: int = Field(default=2, ge=1, le=10)
    llm_retry_backoff_factor: float = Field(default=1.5, gt=0, le=60)
    llm_temperature: float = Field(default=0.0, ge=0, le=2)
    llm_max_tokens: int = Field(default=8192, ge=1, le=65536)

    @property
    def cors_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_allowed_origins.split(",") if item.strip()]

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
        "seaweedfs_master_url",
        "seaweedfs_filer_url",
        "embedding_base_url",
        "embedding_api_key",
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
