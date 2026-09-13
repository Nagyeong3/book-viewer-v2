from __future__ import annotations

import importlib
from typing import Any


class PostgresPool:
    def __init__(self, pool: Any) -> None:
        self._pool = pool

    @classmethod
    async def connect(
        cls,
        database_url: str,
        *,
        min_size: int = 1,
        max_size: int = 10,
        command_timeout: float = 30.0,
    ) -> "PostgresPool":
        try:
            asyncpg = importlib.import_module("asyncpg")
        except ModuleNotFoundError as exc:
            raise RuntimeError("asyncpg is required when DATABASE_URL is configured") from exc
        pool = await asyncpg.create_pool(
            dsn=database_url,
            min_size=min_size,
            max_size=max_size,
            command_timeout=command_timeout,
        )
        if pool is None:
            raise RuntimeError("asyncpg.create_pool returned no pool")
        return cls(pool)

    async def fetch(self, query: str, *args: object):
        return await self._pool.fetch(query, *args)

    async def fetchrow(self, query: str, *args: object):
        return await self._pool.fetchrow(query, *args)

    async def execute(self, query: str, *args: object):
        return await self._pool.execute(query, *args)

    async def ping(self) -> bool:
        value = await self._pool.fetchval("SELECT 1")
        return value == 1

    async def close(self) -> None:
        await self._pool.close()
