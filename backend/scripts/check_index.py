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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Count indexed chunks for one document")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--index")
    target.add_argument("--version", type=int)
    parser.add_argument("--document-id", type=int, required=True)
    return parser.parse_args()


def resolve_index_name(*, index: str | None, version: int | None, alias: str) -> str:
    if index:
        return index
    if version is None:
        raise ValueError("Either index or version must be provided")
    if version < 1:
        raise ValueError("version must be >= 1")
    return f"{alias}-v{version}"


async def main() -> int:
    args = parse_args()
    settings = get_settings()
    if not settings.elasticsearch_url:
        print("ERROR: ELASTICSEARCH_URL is not configured")
        return 2

    index_name = resolve_index_name(
        index=args.index,
        version=args.version,
        alias=settings.es_document_alias,
    )

    client = ElasticsearchClient(
        settings.elasticsearch_url,
        username=settings.elasticsearch_username,
        password=settings.elasticsearch_password,
        timeout=settings.elasticsearch_timeout,
    )
    try:
        index = ElasticsearchDocumentIndex(client, index_name=index_name)
        count = await index.count_document(args.document_id)
        print(f"index={index_name} document_id={args.document_id} chunks={count}")
        return 0
    finally:
        await client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
