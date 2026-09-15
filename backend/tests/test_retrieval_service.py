import pytest

from app.application.retrieval_service import RetrievalService
from app.domain.models.rag import RetrievedChunk


def hit(chunk_id, score, *, document_id=21, content_id=1):
    return RetrievedChunk(
        chunk_id=chunk_id,
        document_id=document_id,
        document_name="Manual",
        content_id=content_id,
        text=f"text-{chunk_id}",
        title_path=("제1장",),
        page=1,
        content_type="text",
        score=score,
    )


class Repo:
    def __init__(self):
        self.calls = []

    async def keyword_search(self, query, document_ids, *, top_k, title_boost):
        self.calls.append(("keyword", query, document_ids, top_k, title_boost))
        return [hit("a", 10.0, content_id=1), hit("b", 5.0, content_id=2)]

    async def vector_search(self, query_vector, document_ids, *, top_k, num_candidates):
        self.calls.append(("vector", query_vector, document_ids, top_k, num_candidates))
        return [hit("b", 0.9, content_id=2), hit("c", 0.7, content_id=3)]


class Embedder:
    async def embed_query(self, text):
        return [0.1, 0.2]


@pytest.mark.asyncio
async def test_hybrid_search_keeps_scope_and_deduplicates():
    repo = Repo()
    service = RetrievalService(repo, Embedder(), candidate_multiplier=2)

    results = await service.search("질문", [21, 104], mode="hybrid", top_k=3)

    assert {result.chunk_id for result in results} == {"a", "b", "c"}
    assert all(call[2] == [21, 104] for call in repo.calls)
    assert results[0].chunk_id == "b"
    assert results[0].keyword_score == 5.0
    assert results[0].vector_score == 0.9


@pytest.mark.asyncio
async def test_search_rejects_empty_document_scope():
    service = RetrievalService(Repo(), Embedder())
    with pytest.raises(ValueError, match="document_ids"):
        await service.search("질문", [], mode="hybrid")
