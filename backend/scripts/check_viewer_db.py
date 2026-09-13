import asyncio

from app.core.config import get_settings
from app.infrastructure.postgres.document_repository import PostgresDocumentRepository
from app.infrastructure.postgres.pool import PostgresPool


async def main() -> int:
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
        repository = PostgresDocumentRepository(pool)
        documents = await repository.list_documents()
        print(f"database=ok documents={len(documents)}")
        if documents:
            first = documents[0]
            contents = await repository.list_contents(first.id)
            print(f"first_document_id={first.id} title={first.title!r} contents={len(contents)}")
        return 0
    finally:
        await pool.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
