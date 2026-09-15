from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.application.retrieval_service import RetrievalService
from app.core.config import get_settings
from app.infrastructure.elasticsearch.client import ElasticsearchClient
from app.infrastructure.elasticsearch.retrieval_repository import ElasticsearchRetrievalRepository
from app.infrastructure.embedding.vllm import VLLMEmbeddingProvider


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke test keyword/vector/hybrid retrieval")
    parser.add_argument("--query", required=True)
    parser.add_argument("--document-ids", required=True, help="comma-separated document IDs")
    parser.add_argument("--mode", choices=["keyword", "vector", "hybrid"], default="hybrid")
    parser.add_argument("--top-k", type=int, default=5)
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    settings = get_settings()
    if not settings.elasticsearch_url or not settings.embedding_base_url:
        print("ERROR: ELASTICSEARCH_URL and EMBEDDING_BASE_URL are required")
        return 2
    document_ids = [int(value.strip()) for value in args.document_ids.split(",") if value.strip()]
    if not document_ids:
        print("ERROR: document_ids must not be empty")
        return 2

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
    try:
        service = RetrievalService(
            ElasticsearchRetrievalRepository(es, index_name=settings.es_document_alias),
            embedding,
            title_boost=settings.retrieval_title_boost,
            keyword_weight=settings.retrieval_keyword_weight,
            vector_weight=settings.retrieval_vector_weight,
            candidate_multiplier=settings.retrieval_candidate_multiplier,
        )
        hits = await service.search(
            args.query,
            document_ids,
            mode=args.mode,
            top_k=args.top_k,
        )
        print(f"retrieval=ok mode={args.mode} hits={len(hits)} scope={document_ids}")
        for position, hit in enumerate(hits, start=1):
            print(
                f"rank={position} score={hit.score:.6f} document_id={hit.document_id} "
                f"content_id={hit.content_id} page={hit.page} title={hit.title!r} "
                f"text={hit.text[:120]!r}"
            )
        return 0
    finally:
        await embedding.close()
        await es.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
