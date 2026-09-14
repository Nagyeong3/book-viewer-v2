import pytest

from app.infrastructure.postgres.index_source_repository import PostgresIndexSourceRepository


class FakePool:
    def __init__(self):
        self.calls = []

    async def fetch(self, query, *args):
        self.calls.append((query, args))
        if "FROM documents" in query and "FROM contents" not in query:
            return [{"id": 1}, {"id": 21}, {"id": 104}]
        return [
            {
                "id": 36347,
                "document_id": 21,
                "document_name": "LAH PDF 교범",
                "parent_id": 36346,
                "origin_order_index": 4,
                "level": 4,
                "page": 1,
                "type": "text",
                "text": "본문",
                "doc_image_path": "/docs/21/page-1.png",
                "cropped_image_path": None,
                "x_min": 10,
                "y_min": 20,
                "x_max": 100,
                "y_max": 200,
            }
        ]


@pytest.mark.asyncio
async def test_repository_lists_document_ids_in_database_order():
    pool = FakePool()
    document_ids = await PostgresIndexSourceRepository(pool).list_document_ids()

    assert document_ids == [1, 21, 104]
    query, args = pool.calls[0]
    assert args == ()
    assert "SELECT id" in query
    assert "FROM documents" in query
    assert "ORDER BY id" in query


@pytest.mark.asyncio
async def test_repository_uses_confirmed_pg_schema_and_order():
    pool = FakePool()
    rows = await PostgresIndexSourceRepository(pool).list_document_contents(21)

    query, args = pool.calls[0]
    assert args == (21,)
    assert "c.document_id" in query
    assert "c.origin_order_index" in query
    assert "d.name AS document_name" in query
    assert "c.x_min" in query
    assert "ORDER BY c.origin_order_index NULLS LAST, c.id" in query
    assert rows[0].document_name == "LAH PDF 교범"
    assert rows[0].x_max == 100
