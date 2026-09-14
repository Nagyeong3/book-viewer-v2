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
    parser = argparse.ArgumentParser(description="Index one PostgreSQL document into a V2 physical Elasticsearch index")
    parser.add_argument("--document-id", type=int, required=True)
    parser.add_argument("--version", type=int, default=1)
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
        max_size=1,
        command_timeout=settings.database_command_timeout,
    )
    es_client = ElasticsearchClient(
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
        manager = DocumentIndexManager(
            es_client,
            alias=settings.es_document_alias,
            vector_dimensions=settings.embedding_dimensions,
        )
        names = await manager.ensure_physical_index(args.version)
        service = IndexingService(PostgresIndexSourceRepository(pool))
        writer = ElasticsearchDocumentIndex(es_client, index_name=names.physical)
        pipeline = DocumentIndexingPipeline(
            service,
            embedding,
            writer,
            vector_dimensions=settings.embedding_dimensions,
            batch_size=args.batch_size,
        )
        report = await pipeline.index_document(args.document_id)
        indexed_count = await writer.count_document(args.document_id)
        print(
            f"indexing=ok index={names.physical} document_id={args.document_id} "
            f"generated_chunks={report.generated_chunks} indexed_chunks={report.indexed_chunks} "
            f"count={indexed_count}"
        )
        if indexed_count != report.indexed_chunks:
            print("ERROR: Elasticsearch count does not match indexed chunk count")
            return 3
        return 0
    finally:
        await embedding.close()
        await es_client.close()
        await pool.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
