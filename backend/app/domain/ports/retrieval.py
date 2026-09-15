from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from app.domain.models.rag import RetrievedChunk


class RetrievalRepository(Protocol):
    async def keyword_search(
        self,
        query: str,
        document_ids: list[int],
        *,
        top_k: int,
        title_boost: float,
    ) -> list[RetrievedChunk]:
        ...

    async def vector_search(
        self,
        query_vector: list[float],
        document_ids: list[int],
        *,
        top_k: int,
        num_candidates: int,
    ) -> list[RetrievedChunk]:
        ...


class QueryEmbeddingProvider(Protocol):
    async def embed_query(self, text: str) -> list[float]:
        ...


class LLMProvider(Protocol):
    async def invoke(self, *, system_prompt: str, user_prompt: str) -> str:
        ...

    def stream(self, *, system_prompt: str, user_prompt: str) -> AsyncIterator[str]:
        ...
