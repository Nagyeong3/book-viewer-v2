from collections.abc import Mapping
import json
from typing import Any

from app.domain.models.viewer import BoundingBox, ContentItem, Document
from app.infrastructure.postgres.pool import PostgresPool


DOCUMENT_COLUMNS = "id, name AS title"
CONTENT_COLUMNS = """
    id,
    document_id,
    text,
    type,
    level AS doc_level,
    parent_id,
    origin_order_index,
    page,
    doc_image_path,
    cropped_image_path,
    x_min AS xmin,
    y_min AS ymin,
    x_max AS xmax,
    y_max AS ymax,
    translations
"""


class PostgresDocumentRepository:
    def __init__(self, pool: PostgresPool) -> None:
        self._pool = pool

    async def list_documents(self) -> list[Document]:
        rows = await self._pool.fetch(f"SELECT {DOCUMENT_COLUMNS} FROM documents ORDER BY id")
        return [self._document(row) for row in rows]

    async def get_document(self, document_id: int) -> Document | None:
        row = await self._pool.fetchrow(
            f"SELECT {DOCUMENT_COLUMNS} FROM documents WHERE id = $1",
            document_id,
        )
        return self._document(row) if row else None

    async def list_contents(self, document_id: int) -> list[ContentItem]:
        rows = await self._pool.fetch(
            f"""SELECT {CONTENT_COLUMNS}
                FROM contents
                WHERE document_id = $1
                ORDER BY origin_order_index NULLS LAST, id""",
            document_id,
        )
        return [self._content(row) for row in rows]

    async def get_content(self, document_id: int, content_id: int) -> ContentItem | None:
        row = await self._pool.fetchrow(
            f"""SELECT {CONTENT_COLUMNS}
                FROM contents
                WHERE document_id = $1 AND id = $2""",
            document_id,
            content_id,
        )
        return self._content(row) if row else None

    async def get_page_image_path(self, document_id: int, page: int) -> str | None:
        row = await self._pool.fetchrow(
            """SELECT doc_image_path
               FROM contents
               WHERE document_id = $1 AND page = $2 AND doc_image_path IS NOT NULL
               ORDER BY origin_order_index NULLS LAST, id
               LIMIT 1""",
            document_id,
            page,
        )
        if not row:
            return None
        value = row.get("doc_image_path")
        return str(value) if value else None

    @staticmethod
    def _document(row: Mapping[str, Any]) -> Document:
        return Document(id=int(row["id"]), title=str(row["title"]))

    @staticmethod
    def _content(row: Mapping[str, Any]) -> ContentItem:
        coords = (row.get("xmin"), row.get("ymin"), row.get("xmax"), row.get("ymax"))
        bbox = None
        if all(value is not None for value in coords):
            bbox = BoundingBox(
                xmin=float(coords[0]),
                ymin=float(coords[1]),
                xmax=float(coords[2]),
                ymax=float(coords[3]),
            )
        return ContentItem(
            id=int(row["id"]),
            document_id=int(row["document_id"]),
            text=row.get("text"),
            content_type=row.get("type"),
            doc_level=int(row["doc_level"]) if row.get("doc_level") is not None else None,
            parent_id=int(row["parent_id"]) if row.get("parent_id") is not None else None,
            order_index=int(row.get("origin_order_index") or 0),
            page=int(row["page"]) if row.get("page") is not None else None,
            cropped_image_path=row.get("cropped_image_path"),
            bbox=bbox,
            doc_image_path=row.get("doc_image_path"),
            translations=PostgresDocumentRepository._translations(row.get("translations")),
        )


    @staticmethod
    def _translations(value: Any) -> dict[str, str] | None:
        if value is None:
            return None
        if isinstance(value, Mapping):
            return {str(key): str(item) for key, item in value.items() if item is not None}
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return None
            if isinstance(parsed, Mapping):
                return {str(key): str(item) for key, item in parsed.items() if item is not None}
        return None
