from dataclasses import dataclass

from fastapi import Request

from app.application.agent_service import AgentService
from app.application.context_builder import ContextBuilder
from app.application.rag_service import RagService
from app.application.retrieval_service import RetrievalService
from app.application.viewer_service import ViewerService
from app.core.config import Settings
from app.infrastructure.elasticsearch.client import ElasticsearchClient
from app.infrastructure.elasticsearch.retrieval_repository import ElasticsearchRetrievalRepository
from app.infrastructure.embedding.vllm import VLLMEmbeddingProvider
from app.infrastructure.llm.litellm import LiteLLMProvider
from app.infrastructure.postgres.document_repository import PostgresDocumentRepository
from app.infrastructure.postgres.pool import PostgresPool


@dataclass(slots=True)
class AppContainer:
    settings: Settings
    postgres_pool: PostgresPool | None = None
    viewer_service: ViewerService | None = None
    elasticsearch_client: ElasticsearchClient | None = None
    embedding_provider: VLLMEmbeddingProvider | None = None
    llm_provider: LiteLLMProvider | None = None
    retrieval_service: RetrievalService | None = None
    rag_service: RagService | None = None
    agent_service: AgentService | None = None

    @classmethod
    async def start(cls, settings: Settings) -> "AppContainer":
        container = cls(settings=settings)
        if settings.database_url:
            pool = await PostgresPool.connect(
                settings.database_url,
                min_size=settings.database_min_pool_size,
                max_size=settings.database_max_pool_size,
                command_timeout=settings.database_command_timeout,
            )
            container.postgres_pool = pool
            container.viewer_service = ViewerService(PostgresDocumentRepository(pool))

        if settings.elasticsearch_url and settings.embedding_base_url:
            es = ElasticsearchClient(
                settings.elasticsearch_url,
                username=settings.elasticsearch_username,
                password=settings.elasticsearch_password,
                timeout=settings.elasticsearch_timeout,
            )
            embedding = VLLMEmbeddingProvider(
                settings.embedding_base_url,
                model=settings.embedding_model,
                api_key=settings.embedding_api_key or "EMPTY",
                timeout=settings.embedding_timeout,
                max_retries=settings.embedding_max_retries,
                retry_backoff_factor=settings.embedding_retry_backoff_factor,
            )
            repository = ElasticsearchRetrievalRepository(
                es,
                index_name=settings.es_document_alias,
            )
            retrieval = RetrievalService(
                repository,
                embedding,
                title_boost=settings.retrieval_title_boost,
                keyword_weight=settings.retrieval_keyword_weight,
                vector_weight=settings.retrieval_vector_weight,
                candidate_multiplier=settings.retrieval_candidate_multiplier,
            )
            container.elasticsearch_client = es
            container.embedding_provider = embedding
            container.retrieval_service = retrieval

            if settings.litellm_base_url and settings.litellm_api_key:
                llm = LiteLLMProvider(
                    settings.litellm_base_url,
                    model=settings.llm_model,
                    api_key=settings.litellm_api_key,
                    timeout=settings.llm_timeout,
                    max_retries=settings.llm_max_retries,
                    temperature=settings.llm_temperature,
                    max_tokens=settings.llm_max_tokens,
                    retry_backoff_factor=settings.llm_retry_backoff_factor,
                )
                context_builder = ContextBuilder(max_chars=settings.rag_context_max_chars)
                container.llm_provider = llm
                container.rag_service = RagService(
                    retrieval,
                    llm,
                    context_builder,
                    default_top_k=settings.rag_top_k,
                )
                container.agent_service = AgentService(
                    retrieval,
                    llm,
                    context_builder,
                    default_top_k=settings.rag_top_k,
                )
        return container

    async def close(self) -> None:
        if self.llm_provider is not None:
            await self.llm_provider.close()
        if self.embedding_provider is not None:
            await self.embedding_provider.close()
        if self.elasticsearch_client is not None:
            await self.elasticsearch_client.close()
        if self.postgres_pool is not None:
            await self.postgres_pool.close()


def get_container(request: Request) -> AppContainer:
    container = getattr(request.app.state, "container", None)
    if not isinstance(container, AppContainer):
        raise RuntimeError("Application container is not initialized")
    return container


def get_viewer_service(request: Request) -> ViewerService:
    container = get_container(request)
    if container.viewer_service is None:
        raise RuntimeError("Viewer service is unavailable because DATABASE_URL is not configured")
    return container.viewer_service


def get_retrieval_service(request: Request) -> RetrievalService:
    container = get_container(request)
    if container.retrieval_service is None:
        raise RuntimeError("Retrieval service is unavailable because Elasticsearch/embedding is not configured")
    return container.retrieval_service


def get_rag_service(request: Request) -> RagService:
    container = get_container(request)
    if container.rag_service is None:
        raise RuntimeError("RAG service is unavailable because retrieval/LiteLLM is not configured")
    return container.rag_service


def get_agent_service(request: Request) -> AgentService:
    container = get_container(request)
    if container.agent_service is None:
        raise RuntimeError("Agent service is unavailable because retrieval/LiteLLM is not configured")
    return container.agent_service
