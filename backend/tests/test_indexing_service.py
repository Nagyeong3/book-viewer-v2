import pytest

from app.application.indexing_service import IndexingService
from app.domain.models.search import IndexSourceContent


def row(
    id,
    *,
    parent_id=None,
    content_type="text",
    text=None,
    level=None,
    order_index=0,
):
    return IndexSourceContent(
        id=id,
        document_id=21,
        document_name="LAH PDF 교범",
        parent_id=parent_id,
        order_index=order_index,
        level=level,
        page=1,
        content_type=content_type,
        text=text,
        doc_image_path=None,
        cropped_image_path=None,
        x_min=None,
        y_min=None,
        x_max=None,
        y_max=None,
    )


class FakeRepository:
    async def list_document_contents(self, document_id):
        assert document_id == 21
        return [
            row(1, content_type="title", text="제 1 장", level=1, order_index=0),
            row(2, parent_id=1, content_type="title", text="총론", level=2, order_index=1),
            row(3, parent_id=1, content_type="title", text="제 1 절 개요", level=2, order_index=2),
            row(4, parent_id=3, content_type="title", text="1.1.1 적용", level=3, order_index=3),
            row(
                5,
                parent_id=4,
                content_type="text",
                text="이 교범은 소형무장헬리콥터에 적용한다.",
                level=4,
                order_index=4,
            ),
            row(6, parent_id=5, content_type="image", text=None, level=None, order_index=5),
        ]


@pytest.mark.asyncio
async def test_build_document_chunks_preserves_parent_title_path():
    chunks = await IndexingService(FakeRepository()).build_document_chunks(21)

    assert len(chunks) == 5
    body = next(chunk for chunk in chunks if chunk.content_id == 5)
    assert body.title_path == ("제 1 장", "제 1 절 개요", "1.1.1 적용")
    assert body.embedding_text.endswith("이 교범은 소형무장헬리콥터에 적용한다.")
    assert body.id == "21:5"


@pytest.mark.asyncio
async def test_title_chunk_embedding_does_not_repeat_leaf_title():
    chunks = await IndexingService(FakeRepository()).build_document_chunks(21)
    title = next(chunk for chunk in chunks if chunk.content_id == 4)
    assert title.embedding_text == "제 1 장\n제 1 절 개요\n1.1.1 적용"


@pytest.mark.asyncio
async def test_rows_without_text_are_not_search_chunks():
    chunks = await IndexingService(FakeRepository()).build_document_chunks(21)
    assert all(chunk.content_id != 6 for chunk in chunks)
