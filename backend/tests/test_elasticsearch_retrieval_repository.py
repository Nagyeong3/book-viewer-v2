import pytest

from app.infrastructure.elasticsearch.retrieval_repository import ElasticsearchRetrievalRepository


class FakeClient:
    def __init__(self):
        self.calls = []

    async def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        return {
            "hits": {
                "hits": [
                    {
                        "_id": "21:10",
                        "_score": 2.5,
                        "_source": {
                            "document_id": 21,
                            "document_name": "Manual",
                            "content_id": 10,
                            "text": "본문",
                            "title_path": ["제1장"],
                            "page": 3,
                            "content_type": "text",
                        },
                    }
                ]
            }
        }


@pytest.mark.asyncio
async def test_keyword_search_applies_document_scope_and_title_boost():
    client = FakeClient()
    repo = ElasticsearchRetrievalRepository(client, index_name="rag-documents")

    hits = await repo.keyword_search("유압", [21, 104], top_k=5, title_boost=3.0)

    body = client.calls[0][2]["json"]
    assert body["query"]["bool"]["filter"] == [{"terms": {"document_id": [21, 104]}}]
    assert body["query"]["bool"]["must"][0]["multi_match"]["fields"] == ["title_path^3.0", "text"]
    assert hits[0].keyword_score == 2.5


@pytest.mark.asyncio
async def test_vector_search_applies_document_scope():
    client = FakeClient()
    repo = ElasticsearchRetrievalRepository(client, index_name="rag-documents")

    hits = await repo.vector_search([0.1, 0.2], [21], top_k=3, num_candidates=12)

    body = client.calls[0][2]["json"]
    assert body["knn"]["filter"] == {"terms": {"document_id": [21]}}
    assert body["knn"]["k"] == 3
    assert body["knn"]["num_candidates"] == 12
    assert hits[0].vector_score == 2.5


@pytest.mark.asyncio
async def test_repository_never_accepts_empty_scope():
    repo = ElasticsearchRetrievalRepository(FakeClient(), index_name="rag-documents")
    with pytest.raises(ValueError, match="document_ids"):
        await repo.keyword_search("x", [], top_k=1, title_boost=3.0)
