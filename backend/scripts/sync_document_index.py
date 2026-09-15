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
from app.infrastructure.elasticsearch.index_manager import DocumentIndexManager, IndexNames
from app.infrastructure.embedding.vllm import VLLMEmbeddingProvider
from app.infrastructure.postgres.index_source_repository import PostgresIndexSourceRepository
from app.infrastructure.postgres.pool import PostgresPool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Safely re-index one PostgreSQL document into the active or selected V2 index"
    )
    parser.add_argument("--document-id", type=int, required=True)
    parser.add_argument("--version", type=int)
    parser.add_argument("--index")
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()
    if args.version is not None and args.index:
        parser.error("use only one of --version or --index")
    return args


async def resolve_target_index(
    client: ElasticsearchClient,
    *,
    alias: str,
    version: int | None,
    explicit_index: str | None,
    vector_dimensions: int,
) -> str:
    if explicit_index:
        if not await client.index_exists(explicit_index):
            raise RuntimeError(f"target index does not exist: {explicit_index}")
        return explicit_index
    if version is not None:
        names = IndexNames(alias=alias, version=version)
        if not await client.index_exists(names.physical):
            raise RuntimeError(f"target index does not exist: {names.physical}")
        return names.physical

    manager = DocumentIndexManager(
        client,
        alias=alias,
        vector_dimensions=vector_dimensions,
    )
    targets = await manager.alias_targets()
    if len(targets) != 1:
        raise RuntimeError(
            f"alias {alias!r} must point to exactly one physical index; targets={list(targets)}"
        )
    return targets[0]


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
        target_name = await resolve_target_index(
            es,
            alias=settings.es_document_alias,
            version=args.version,
            explicit_index=args.index,
            vector_dimensions=settings.embedding_dimensions,
        )
        source = PostgresIndexSourceRepository(pool)
        service = IndexingService(source)
        current_chunks = await service.build_document_chunks(args.document_id)
        current_content_ids = [chunk.content_id for chunk in current_chunks]

        target = ElasticsearchDocumentIndex(es, index_name=target_name)
        before_count = await target.count_document(args.document_id)

        pipeline = DocumentIndexingPipeline(
            service,
            embedding,
            target,
            vector_dimensions=settings.embedding_dimensions,
            batch_size=args.batch_size,
        )
        report = await pipeline.index_document(args.document_id)

        deleted_stale = await target.delete_stale_document_chunks(
            args.document_id,
            current_content_ids,
        )
        after_count = await target.count_document(args.document_id)
        if after_count != report.generated_chunks:
            print(
                f"ERROR: sync count mismatch document_id={args.document_id} "
                f"expected={report.generated_chunks} actual={after_count}"
            )
            return 4

        print(
            f"sync=ok index={target_name} document_id={args.document_id} "
            f"before={before_count} current={after_count} stale_deleted={deleted_stale}"
        )
        return 0
    finally:
        await embedding.close()
        await es.close()
        await pool.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
