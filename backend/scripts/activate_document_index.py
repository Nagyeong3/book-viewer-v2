from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings
from app.infrastructure.elasticsearch.client import ElasticsearchClient
from app.infrastructure.elasticsearch.document_index import ElasticsearchDocumentIndex
from app.infrastructure.elasticsearch.index_manager import DocumentIndexManager, IndexNames


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Atomically point the V2 document alias at a validated physical index"
    )
    parser.add_argument("--version", type=int, required=True)
    parser.add_argument("--expected-count", type=int, required=True)
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    settings = get_settings()
    if not settings.elasticsearch_url:
        print("ERROR: ELASTICSEARCH_URL is not configured")
        return 2

    client = ElasticsearchClient(
        settings.elasticsearch_url,
        username=settings.elasticsearch_username,
        password=settings.elasticsearch_password,
        timeout=settings.elasticsearch_timeout,
    )
    try:
        names = IndexNames(alias=settings.es_document_alias, version=args.version)
        if not await client.index_exists(names.physical):
            print(f"ERROR: physical index does not exist: {names.physical}")
            return 3

        index = ElasticsearchDocumentIndex(client, index_name=names.physical)
        actual_count = await index.count_all()
        if actual_count != args.expected_count:
            print(
                f"ERROR: count mismatch index={names.physical} "
                f"expected={args.expected_count} actual={actual_count}"
            )
            return 4
        if actual_count <= 0:
            print("ERROR: refusing to activate an empty index")
            return 5

        manager = DocumentIndexManager(
            client,
            alias=settings.es_document_alias,
            vector_dimensions=settings.embedding_dimensions,
        )
        before = await manager.alias_targets()
        await manager.activate(args.version)
        after = await manager.alias_targets()
        if after != (names.physical,):
            print(f"ERROR: alias validation failed targets={list(after)}")
            return 6

        print(
            f"alias_activation=ok alias={settings.es_document_alias} "
            f"before={list(before)} after={list(after)} chunks={actual_count}"
        )
        return 0
    finally:
        await client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
