from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.application.context_builder import ContextBuilder
from app.application.rag_service import RagService
from app.application.retrieval_service import RetrievalService
from app.core.config import get_settings
from app.infrastructure.elasticsearch.client import ElasticsearchClient
from app.infrastructure.elasticsearch.retrieval_repository import ElasticsearchRetrievalRepository
from app.infrastructure.embedding.vllm import VLLMEmbeddingProvider
from app.infrastructure.llm.litellm import LiteLLMProvider


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="End-to-end deterministic RAG smoke test")
    parser.add_argument("--question", required=True)
    parser.add_argument("--document-ids", required=True)
    parser.add_argument("--mode", choices=["keyword", "vector", "hybrid"], default="hybrid")
    parser.add_argument("--top-k", type=int, default=5)
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    settings = get_settings()
    if not settings.elasticsearch_url or not settings.embedding_base_url:
        print("ERROR: Elasticsearch/embedding configuration is required")
        return 2
    if not settings.litellm_base_url or not settings.litellm_api_key:
        print("ERROR: LiteLLM configuration is required")
        return 2
    document_ids = [int(value.strip()) for value in args.document_ids.split(",") if value.strip()]

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
    try:
        retrieval = RetrievalService(
            ElasticsearchRetrievalRepository(es, index_name=settings.es_document_alias),
            embedding,
            title_boost=settings.retrieval_title_boost,
            keyword_weight=settings.retrieval_keyword_weight,
            vector_weight=settings.retrieval_vector_weight,
            candidate_multiplier=settings.retrieval_candidate_multiplier,
        )
        service = RagService(
            retrieval,
            llm,
            ContextBuilder(max_chars=settings.rag_context_max_chars),
            default_top_k=settings.rag_top_k,
        )
        result = await service.answer(
            args.question,
            document_ids,
            mode=args.mode,
            top_k=args.top_k,
        )
        print(f"rag=ok mode={result.mode} sources={len(result.sources)}")
        print("answer=" + result.answer)
        for source in result.sources:
            print(
                f"source={source.source_id} document_id={source.document_id} "
                f"content_id={source.content_id} page={source.page} "
                f"title={' > '.join(source.title_path)!r}"
            )
        return 0
    finally:
        await llm.close()
        await embedding.close()
        await es.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
