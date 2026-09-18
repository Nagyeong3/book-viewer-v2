from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Literal

from app.application.document_indexing_pipeline import DocumentIndexingPipeline
from app.application.indexing_service import IndexingService
from app.infrastructure.elasticsearch.client import ElasticsearchClient
from app.infrastructure.elasticsearch.document_index import ElasticsearchDocumentIndex
from app.infrastructure.elasticsearch.index_manager import DocumentIndexManager
from app.infrastructure.embedding.vllm import VLLMEmbeddingProvider
from app.infrastructure.postgres.index_source_repository import PostgresIndexSourceRepository
from app.infrastructure.postgres.pool import PostgresPool

IndexState = Literal["ready", "missing", "queued", "indexing", "failed"]


@dataclass(frozen=True, slots=True)
class DocumentIndexStatus:
    document_id: int
    state: IndexState
    indexed_chunks: int
    message: str | None = None


class IndexManagementService:
    def __init__(
        self,
        pool: PostgresPool,
        elasticsearch: ElasticsearchClient,
        embedding_provider: VLLMEmbeddingProvider,
        *,
        alias: str,
        vector_dimensions: int,
        batch_size: int = 32,
    ) -> None:
        self._source = PostgresIndexSourceRepository(pool)
        self._indexing = IndexingService(self._source)
        self._elasticsearch = elasticsearch
        self._embedding_provider = embedding_provider
        self._alias = alias
        self._vector_dimensions = vector_dimensions
        self._batch_size = batch_size
        self._manager = DocumentIndexManager(
            elasticsearch,
            alias=alias,
            vector_dimensions=vector_dimensions,
        )
        self._jobs: dict[int, asyncio.Task[None]] = {}
        self._states: dict[int, DocumentIndexStatus] = {}
        self._worker_lock = asyncio.Lock()

    async def statuses(self, document_ids: list[int] | None = None) -> list[DocumentIndexStatus]:
        ids = document_ids or await self._source.list_document_ids()
        return list(await asyncio.gather(*(self.status(document_id) for document_id in ids)))

    async def status(self, document_id: int) -> DocumentIndexStatus:
        cached = self._states.get(document_id)
        if cached and cached.state in {"queued", "indexing"}:
            return cached

        target = ElasticsearchDocumentIndex(self._elasticsearch, index_name=self._alias)
        try:
            count = await target.count_document(document_id)
        except Exception as exc:
            if cached and cached.state == "failed":
                return cached
            return DocumentIndexStatus(
                document_id=document_id,
                state="failed",
                indexed_chunks=0,
                message=f"Elasticsearch 상태 확인 실패: {exc}",
            )
        if count > 0:
            return DocumentIndexStatus(document_id=document_id, state="ready", indexed_chunks=count)
        if cached and cached.state == "failed":
            return cached
        return DocumentIndexStatus(document_id=document_id, state="missing", indexed_chunks=0)

    async def missing_document_ids(self, document_ids: list[int]) -> list[int]:
        statuses = await self.statuses(document_ids)
        return [item.document_id for item in statuses if item.state != "ready"]

    async def start_indexing(self, document_id: int) -> DocumentIndexStatus:
        existing = self._jobs.get(document_id)
        if existing is not None and not existing.done():
            return self._states.get(
                document_id,
                DocumentIndexStatus(document_id, "queued", 0, "벡터 DB 구축 대기 중"),
            )

        self._states[document_id] = DocumentIndexStatus(
            document_id=document_id,
            state="queued",
            indexed_chunks=0,
            message="벡터 DB 구축 대기 중",
        )
        task = asyncio.create_task(self._run_indexing(document_id))
        self._jobs[document_id] = task
        return self._states[document_id]

    async def _run_indexing(self, document_id: int) -> None:
        try:
            async with self._worker_lock:
                self._states[document_id] = DocumentIndexStatus(
                    document_id=document_id,
                    state="indexing",
                    indexed_chunks=0,
                    message="PostgreSQL 문서를 임베딩하여 Elasticsearch에 반영 중",
                )
                targets = await self._manager.alias_targets()
                if len(targets) != 1:
                    raise RuntimeError(
                        f"alias {self._alias!r} must point to exactly one physical index; targets={list(targets)}"
                    )
                target = ElasticsearchDocumentIndex(self._elasticsearch, index_name=targets[0])
                current_chunks = await self._indexing.build_document_chunks(document_id)
                if not current_chunks:
                    raise RuntimeError("검색 가능한 문서 chunk가 없습니다")

                current_content_ids = [chunk.content_id for chunk in current_chunks]
                pipeline = DocumentIndexingPipeline(
                    self._indexing,
                    self._embedding_provider,
                    target,
                    vector_dimensions=self._vector_dimensions,
                    batch_size=self._batch_size,
                )
                report = await pipeline.index_document(document_id)
                await target.delete_stale_document_chunks(document_id, current_content_ids)
                after_count = await target.count_document(document_id)
                if after_count != report.generated_chunks:
                    raise RuntimeError(
                        f"sync count mismatch: expected={report.generated_chunks} actual={after_count}"
                    )
                self._states[document_id] = DocumentIndexStatus(
                    document_id=document_id,
                    state="ready",
                    indexed_chunks=after_count,
                    message="벡터 DB 구축 완료",
                )
        except Exception as exc:
            self._states[document_id] = DocumentIndexStatus(
                document_id=document_id,
                state="failed",
                indexed_chunks=0,
                message=str(exc),
            )

    async def close(self) -> None:
        tasks = [task for task in self._jobs.values() if not task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
