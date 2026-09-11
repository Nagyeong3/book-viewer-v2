from typing import Protocol

from app.domain.models.search import RetrievalResult, SearchScope


class Retriever(Protocol):
    async def retrieve(
        self, query: str, scope: SearchScope, *, top_k: int
    ) -> list[RetrievalResult]: ...
