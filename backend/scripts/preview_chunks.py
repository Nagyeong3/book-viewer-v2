from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.application.indexing_service import IndexingService
from app.core.config import get_settings
from app.infrastructure.postgres.index_source_repository import PostgresIndexSourceRepository
from app.infrastructure.postgres.pool import PostgresPool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Preview PG -> search chunk conversion")
    parser.add_argument("--document-id", type=int, required=True)
    parser.add_argument("--limit", type=int, default=20)
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    settings = get_settings()
    if not settings.database_url:
        print("ERROR: DATABASE_URL is not configured")
        return 2

    pool = await PostgresPool.connect(
        settings.database_url,
        min_size=1,
        max_size=1,
        command_timeout=settings.database_command_timeout,
    )
    try:
        service = IndexingService(PostgresIndexSourceRepository(pool))
        chunks = await service.build_document_chunks(args.document_id)
        print(f"document_id={args.document_id} searchable_chunks={len(chunks)}")
        for chunk in chunks[: max(args.limit, 0)]:
            print(
                f"chunk={chunk.id} page={chunk.page} type={chunk.content_type!r} "
                f"level={chunk.level} title_path={list(chunk.title_path)!r} "
                f"text={chunk.text[:120]!r}"
            )
        return 0
    finally:
        await pool.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
