from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.domain.models.search import IndexSourceContent
from app.infrastructure.postgres.pool import PostgresPool


INDEX_SOURCE_QUERY = """
SELECT
    c.id,
    c.document_id,
    d.name AS document_name,
    c.parent_id,
    c.origin_order_index,
    c.level,
    c.page,
    c.type,
    c.text,
    c.doc_image_path,
    c.cropped_image_path,
    c.x_min,
    c.y_min,
    c.x_max,
    c.y_max
FROM contents AS c
JOIN documents AS d ON d.id = c.document_id
WHERE c.document_id = $1
ORDER BY c.origin_order_index NULLS LAST, c.id
"""


class PostgresIndexSourceRepository:
    def __init__(self, pool: PostgresPool) -> None:
        self._pool = pool

    async def list_document_contents(self, document_id: int) -> list[IndexSourceContent]:
        rows = await self._pool.fetch(INDEX_SOURCE_QUERY, document_id)
        return [self._map_row(row) for row in rows]

    @staticmethod
    def _map_row(row: Mapping[str, Any]) -> IndexSourceContent:
        return IndexSourceContent(
            id=int(row["id"]),
            document_id=int(row["document_id"]),
            document_name=str(row["document_name"]),
            parent_id=int(row["parent_id"]) if row.get("parent_id") is not None else None,
            order_index=int(row.get("origin_order_index") or 0),
            level=int(row["level"]) if row.get("level") is not None else None,
            page=int(row["page"]) if row.get("page") is not None else None,
            content_type=row.get("type"),
            text=row.get("text"),
            doc_image_path=row.get("doc_image_path"),
            cropped_image_path=row.get("cropped_image_path"),
            x_min=int(row["x_min"]) if row.get("x_min") is not None else None,
            y_min=int(row["y_min"]) if row.get("y_min") is not None else None,
            x_max=int(row["x_max"]) if row.get("x_max") is not None else None,
            y_max=int(row["y_max"]) if row.get("y_max") is not None else None,
        )
