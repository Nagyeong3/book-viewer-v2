from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.application.document_indexing_pipeline import DocumentIndexingPipeline
from app.application.indexing_service import IndexingService
from app.core.config import get_settings
from app.infrastructure.elasticsearch.client import ElasticsearchClient
from app.infrastructure.elasticsearch.document_index import ElasticsearchDocumentIndex
from app.infrastructure.elasticsearch.index_manager import DocumentIndexManager
from app.infrastructure.embedding.vllm import VLLMEmbeddingProvider
from app.infrastructure.postgres.index_source_repository import PostgresIndexSourceRepository
from app.infrastructure.postgres.pool import PostgresPool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild all PostgreSQL documents into a new V2 Elasticsearch physical index"
    )
    parser.add_argument("--version", type=int, required=True)
    parser.add_argument("--batch-size", type=int, default=32)
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    settings = get_settings()
    if not settings.database_url:
        print("ERROR: DATABASE_URL is not configured")
        return 2
    if not settings.elasticsearch_url:
        print("ERROR: ELASTICSEARCH_URL is not configured")
        return 2
    if not settings.embedding_base_url:
        print("ERROR: EMBEDDING_BASE_URL is not configured")
        return 2

    pool = await PostgresPool.connect(
        settings.database_url,
        min_size=1,
        max_size=settings.database_max_pool_size,
        command_timeout=settings.database_command_timeout,
    )
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
        source = PostgresIndexSourceRepository(pool)
        manager = DocumentIndexManager(
            es,
            alias=settings.es_document_alias,
            vector_dimensions=settings.embedding_dimensions,
        )
        names = await manager.ensure_physical_index(args.version)
        target = ElasticsearchDocumentIndex(es, index_name=names.physical)
        existing = await target.count_all()
        if existing != 0:
            print(
                f"ERROR: target index {names.physical} is not empty (chunks={existing}). "
                "Use a new version number for a safe rebuild."
            )
            return 3

        document_ids = await source.list_document_ids()
        service = IndexingService(source)
        pipeline = DocumentIndexingPipeline(
            service,
            embedding,
            target,
            vector_dimensions=settings.embedding_dimensions,
            batch_size=args.batch_size,
        )

        expected_total = 0
        for position, document_id in enumerate(document_ids, start=1):
            report = await pipeline.index_document(document_id)
            expected_total += report.indexed_chunks
            print(
                f"progress={position}/{len(document_ids)} document_id={document_id} "
                f"chunks={report.indexed_chunks}"
            )

        actual_total = await target.count_all()
        if actual_total != expected_total:
            print(
                f"ERROR: rebuild count mismatch expected={expected_total} actual={actual_total}"
            )
            return 4

        print(
            f"rebuild=ok index={names.physical} documents={len(document_ids)} "
            f"chunks={actual_total} alias_unchanged=true"
        )
        return 0
    finally:
        await embedding.close()
        await es.close()
        await pool.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
