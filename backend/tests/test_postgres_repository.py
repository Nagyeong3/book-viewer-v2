import pytest

from app.infrastructure.postgres.document_repository import PostgresDocumentRepository


class FakePool:
    def __init__(self):
        self.calls = []

    async def fetch(self, query, *args):
        self.calls.append((query, args))
        if "FROM documents" in query:
            return [{"id": 1, "title": "Manual"}]
        return [{
            "id": 7, "document_id": 1, "text": "hello", "type": "text",
            "doc_level": None, "parent_id": None, "origin_order_index": 3,
            "page": 2, "cropped_image_path": None,
            "xmin": 1, "ymin": 2, "xmax": 10, "ymax": 20,
        }]

    async def fetchrow(self, query, *args):
        rows = await self.fetch(query, *args)
        return rows[0] if rows else None


@pytest.mark.asyncio
async def test_repository_maps_document_and_content() -> None:
    pool = FakePool()
    repo = PostgresDocumentRepository(pool)
    documents = await repo.list_documents()
    assert documents[0].title == "Manual"
    assert "name AS title" in pool.calls[-1][0]

    contents = await repo.list_contents(1)
    assert contents[0].id == 7
    assert contents[0].bbox.xmax == 10.0
    query, args = pool.calls[-1]
    assert args == (1,)
    assert "documnet_id AS document_id" in query
    assert "level AS doc_level" in query
    assert "orgin_order_index AS origin_order_index" in query
    assert "x_min AS xmin" in query
    assert "WHERE documnet_id = $1" in query


@pytest.mark.asyncio
async def test_get_content_enforces_document_scope() -> None:
    pool = FakePool()
    repo = PostgresDocumentRepository(pool)
    await repo.get_content(5, 7)
    assert pool.calls[-1][1] == (5, 7)
    assert "documnet_id = $1 AND id = $2" in pool.calls[-1][0]
