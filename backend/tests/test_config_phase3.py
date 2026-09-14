from app.core.config import Settings


def test_phase3_defaults_are_safe_and_explicit():
    settings = Settings()
    assert settings.es_document_alias == "rag-documents"
    assert settings.embedding_model == "bge-m3"
    assert settings.embedding_dimensions == 1024
    assert settings.elasticsearch_timeout == 30.0


def test_optional_service_urls_normalize_blank_to_none():
    settings = Settings(elasticsearch_url=" ", embedding_base_url=" ")
    assert settings.elasticsearch_url is None
    assert settings.embedding_base_url is None
