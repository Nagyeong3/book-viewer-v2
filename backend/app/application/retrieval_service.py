from __future__ import annotations

from app.domain.models.rag import RetrievedChunk, RetrievalMode
from app.domain.ports.retrieval import QueryEmbeddingProvider, RetrievalRepository


class RetrievalService:
    def __init__(
        self,
        repository: RetrievalRepository,
        embedding_provider: QueryEmbeddingProvider,
        *,
        title_boost: float = 3.0,
        keyword_weight: float = 0.5,
        vector_weight: float = 0.5,
        candidate_multiplier: int = 4,
    ) -> None:
        self._repository = repository
        self._embedding_provider = embedding_provider
        self._title_boost = title_boost
        self._keyword_weight = keyword_weight
        self._vector_weight = vector_weight
        self._candidate_multiplier = max(candidate_multiplier, 1)

    async def search(
        self,
        query: str,
        document_ids: list[int],
        *,
        mode: RetrievalMode = "hybrid",
        top_k: int = 8,
    ) -> list[RetrievedChunk]:
        if not query.strip():
            raise ValueError("query must not be empty")
        if not document_ids:
            raise ValueError("document_ids must not be empty")
        if top_k < 1:
            raise ValueError("top_k must be >= 1")

        if mode == "keyword":
            return await self._repository.keyword_search(
                query,
                document_ids,
                top_k=top_k,
                title_boost=self._title_boost,
            )

        vector = await self._embedding_provider.embed_query(query)
        if mode == "vector":
            return await self._repository.vector_search(
                vector,
                document_ids,
                top_k=top_k,
                num_candidates=top_k * self._candidate_multiplier,
            )

        if mode != "hybrid":
            raise ValueError(f"unsupported retrieval mode: {mode}")

        candidate_k = top_k * self._candidate_multiplier
        keyword_hits = await self._repository.keyword_search(
            query,
            document_ids,
            top_k=candidate_k,
            title_boost=self._title_boost,
        )
        vector_hits = await self._repository.vector_search(
            vector,
            document_ids,
            top_k=candidate_k,
            num_candidates=candidate_k * self._candidate_multiplier,
        )
        return self._fuse(keyword_hits, vector_hits, top_k=top_k)

    def _fuse(
        self,
        keyword_hits: list[RetrievedChunk],
        vector_hits: list[RetrievedChunk],
        *,
        top_k: int,
    ) -> list[RetrievedChunk]:
        combined: dict[str, RetrievedChunk] = {}
        scores: dict[str, float] = {}

        for rank, hit in enumerate(keyword_hits, start=1):
            combined[hit.chunk_id] = hit
            scores[hit.chunk_id] = scores.get(hit.chunk_id, 0.0) + self._keyword_weight / rank
        for rank, hit in enumerate(vector_hits, start=1):
            existing = combined.get(hit.chunk_id)
            combined[hit.chunk_id] = existing or hit
            scores[hit.chunk_id] = scores.get(hit.chunk_id, 0.0) + self._vector_weight / rank

        keyword_raw = {hit.chunk_id: hit.score for hit in keyword_hits}
        vector_raw = {hit.chunk_id: hit.score for hit in vector_hits}
        fused = [
            RetrievedChunk(
                chunk_id=hit.chunk_id,
                document_id=hit.document_id,
                document_name=hit.document_name,
                content_id=hit.content_id,
                text=hit.text,
                title_path=hit.title_path,
                page=hit.page,
                content_type=hit.content_type,
                score=scores[chunk_id],
                keyword_score=keyword_raw.get(chunk_id),
                vector_score=vector_raw.get(chunk_id),
            )
            for chunk_id, hit in combined.items()
        ]
        fused.sort(key=lambda item: (-item.score, item.document_id, item.content_id))
        return fused[:top_k]
