from __future__ import annotations

from app.domain.models.search import IndexSourceContent, SearchChunk
from app.domain.ports.indexing import IndexSourceRepository


_TITLE_TYPES = frozenset({"title", "sub_title"})


class HierarchyResolver:
    def __init__(self, rows: list[IndexSourceContent]) -> None:
        self._by_id = {row.id: row for row in rows}

    def title_path_for(self, row: IndexSourceContent) -> tuple[str, ...]:
        chain: list[IndexSourceContent] = []
        seen: set[int] = set()
        current: IndexSourceContent | None = row

        while current is not None and current.id not in seen:
            seen.add(current.id)
            if self._is_title(current):
                chain.append(current)
            current = self._by_id.get(current.parent_id) if current.parent_id is not None else None

        chain.reverse()
        return tuple(item.text.strip() for item in chain if item.text and item.text.strip())

    @staticmethod
    def _is_title(row: IndexSourceContent) -> bool:
        return row.content_type in _TITLE_TYPES and bool(row.text and row.text.strip())


class IndexingService:
    def __init__(self, source_repository: IndexSourceRepository) -> None:
        self._source_repository = source_repository

    async def build_document_chunks(self, document_id: int) -> list[SearchChunk]:
        rows = await self._source_repository.list_document_contents(document_id)
        resolver = HierarchyResolver(rows)
        chunks: list[SearchChunk] = []

        for row in rows:
            if not row.text or not row.text.strip():
                continue
            chunks.append(
                SearchChunk(
                    id=f"{row.document_id}:{row.id}",
                    document_id=row.document_id,
                    document_name=row.document_name,
                    content_id=row.id,
                    parent_id=row.parent_id,
                    order_index=row.order_index,
                    level=row.level,
                    page=row.page,
                    content_type=row.content_type,
                    text=row.text.strip(),
                    title_path=resolver.title_path_for(row),
                    doc_image_path=row.doc_image_path,
                    cropped_image_path=row.cropped_image_path,
                    x_min=row.x_min,
                    y_min=row.y_min,
                    x_max=row.x_max,
                    y_max=row.y_max,
                )
            )
        return chunks
