from __future__ import annotations

from dataclasses import dataclass

from app.application.indexing_service import IndexingService
from app.domain.ports.indexing import EmbeddingProvider, SearchIndexWriter


@dataclass(frozen=True, slots=True)
class IndexingReport:
    document_id: int
    generated_chunks: int
    indexed_chunks: int


class DocumentIndexingPipeline:
    def __init__(
        self,
        indexing_service: IndexingService,
        embedding_provider: EmbeddingProvider,
        index_writer: SearchIndexWriter,
        *,
        vector_dimensions: int,
        batch_size: int = 32,
    ) -> None:
        if batch_size < 1:
            raise ValueError("batch_size must be >= 1")
        self._indexing_service = indexing_service
        self._embedding_provider = embedding_provider
        self._index_writer = index_writer
        self._vector_dimensions = vector_dimensions
        self._batch_size = batch_size

    async def index_document(self, document_id: int) -> IndexingReport:
        chunks = await self._indexing_service.build_document_chunks(document_id)
        indexed_total = 0

        for start in range(0, len(chunks), self._batch_size):
            batch = chunks[start : start + self._batch_size]
            embedded = await self._embedding_provider.embed(
                [chunk.embedding_text for chunk in batch]
            )
            if len(embedded) != len(batch):
                raise RuntimeError(
                    "Embedding provider returned a different number of vectors than inputs"
                )
            for vector in embedded:
                if len(vector) != self._vector_dimensions:
                    raise RuntimeError(
                        f"Embedding dimension mismatch: expected {self._vector_dimensions}, "
                        f"got {len(vector)}"
                    )

            indexed = await self._index_writer.bulk_index(batch, embedded)
            if indexed != len(batch):
                raise RuntimeError(
                    f"Index writer count mismatch: expected {len(batch)}, got {indexed}"
                )
            indexed_total += indexed

        return IndexingReport(
            document_id=document_id,
            generated_chunks=len(chunks),
            indexed_chunks=indexed_total,
        )
