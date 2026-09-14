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
    parser.add_argument("--index", required=True)
    parser.add_argument("--document-id", type=int, required=True)
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
        index = ElasticsearchDocumentIndex(client, index_name=args.index)
        count = await index.count_document(args.document_id)
        print(f"index={args.index} document_id={args.document_id} chunks={count}")
        return 0
    finally:
        await client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
