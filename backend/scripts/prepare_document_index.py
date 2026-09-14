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
from app.infrastructure.elasticsearch.index_manager import DocumentIndexManager


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a versioned V2 document index")
    parser.add_argument("--version", type=int, required=True)
    parser.add_argument(
        "--activate",
        action="store_true",
        help="Swap the V2 alias after index creation. Omit for safe preparation only.",
    )
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
        manager = DocumentIndexManager(
            client,
            alias=settings.es_document_alias,
            vector_dimensions=settings.embedding_dimensions,
        )
        names = await manager.ensure_physical_index(args.version)
        print(f"physical_index={names.physical} status=ready")
        if args.activate:
            await manager.activate(args.version)
            print(f"alias={names.alias} target={names.physical} status=active")
        else:
            print("alias_unchanged=true")
        return 0
    finally:
        await client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
