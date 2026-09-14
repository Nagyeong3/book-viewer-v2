import json

import pytest

from app.domain.models.search import SearchChunk
from app.infrastructure.elasticsearch.document_index import ElasticsearchDocumentIndex


class FakeClient:
    def __init__(self):
        self.calls = []

    async def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if path.endswith("/_count"):
            return {"count": 2}
        return {"errors": False, "items": []}


def chunk(content_id):
    return SearchChunk(
        id=f"21:{content_id}",
        document_id=21,
        document_name="LAH PDF 교범",
        content_id=content_id,
        parent_id=None,
        order_index=content_id,
        level=1,
        page=1,
        content_type="text",
        text="본문",
        title_path=("제1장",),
        doc_image_path=None,
        cropped_image_path=None,
        x_min=None,
        y_min=None,
        x_max=None,
        y_max=None,
    )


@pytest.mark.asyncio
async def test_bulk_writer_uses_deterministic_ids_and_ndjson():
    client = FakeClient()
    writer = ElasticsearchDocumentIndex(client, index_name="rag-documents-v1")

    indexed = await writer.bulk_index([chunk(1), chunk(2)], [[0.1] * 4, [0.2] * 4])

    assert indexed == 2
    method, path, kwargs = client.calls[0]
    assert (method, path) == ("POST", "/_bulk")
    lines = kwargs["content"].strip().splitlines()
    assert len(lines) == 4
    assert json.loads(lines[0])["index"]["_id"] == "21:1"
    assert json.loads(lines[1])["document_id"] == 21
    assert json.loads(lines[1])["vector"] == [0.1] * 4
    assert kwargs["headers"]["Content-Type"] == "application/x-ndjson"


@pytest.mark.asyncio
async def test_count_all_uses_physical_index_count_endpoint():
    client = FakeClient()
    writer = ElasticsearchDocumentIndex(client, index_name="rag-documents-v2")

    count = await writer.count_all()

    assert count == 2
    assert client.calls[0][:2] == ("GET", "/rag-documents-v2/_count")


@pytest.mark.asyncio
async def test_count_document_uses_document_filter():
    client = FakeClient()
    writer = ElasticsearchDocumentIndex(client, index_name="rag-documents-v1")

    count = await writer.count_document(21)

    assert count == 2
    assert client.calls[0][2]["json"] == {"query": {"term": {"document_id": 21}}}
