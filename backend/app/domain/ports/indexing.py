from __future__ import annotations

from typing import Protocol

from app.domain.models.search import IndexSourceContent, SearchChunk


class IndexSourceRepository(Protocol):
    async def list_document_ids(self) -> list[int]:
        ...

    async def list_document_contents(self, document_id: int) -> list[IndexSourceContent]:
        ...


class EmbeddingProvider(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]:
        ...


class SearchIndexWriter(Protocol):
    async def bulk_index(
        self,
        chunks: list[SearchChunk],
        vectors: list[list[float]],
    ) -> int:
        ...
