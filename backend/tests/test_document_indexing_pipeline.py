import pytest

from app.application.document_indexing_pipeline import DocumentIndexingPipeline
from app.application.indexing_service import IndexingService
from app.domain.models.search import IndexSourceContent


class SourceRepository:
    async def list_document_contents(self, document_id):
        return [
            IndexSourceContent(
                id=1,
                document_id=document_id,
                document_name="Manual",
                parent_id=None,
                order_index=0,
                level=1,
                page=1,
                content_type="title",
                text="제1장",
                doc_image_path=None,
                cropped_image_path=None,
                x_min=None,
                y_min=None,
                x_max=None,
                y_max=None,
            ),
            IndexSourceContent(
                id=2,
                document_id=document_id,
                document_name="Manual",
                parent_id=1,
                order_index=1,
                level=2,
                page=1,
                content_type="text",
                text="본문",
                doc_image_path=None,
                cropped_image_path=None,
                x_min=None,
                y_min=None,
                x_max=None,
                y_max=None,
            ),
        ]


class FakeEmbeddingProvider:
    def __init__(self, dimensions=4):
        self.dimensions = dimensions
        self.calls = []

    async def embed(self, texts):
        self.calls.append(texts)
        return [[float(index)] * self.dimensions for index, _ in enumerate(texts, start=1)]


class FakeWriter:
    def __init__(self):
        self.calls = []

    async def bulk_index(self, chunks, vectors):
        self.calls.append((chunks, vectors))
        return len(chunks)


@pytest.mark.asyncio
async def test_pipeline_embeds_and_indexes_in_same_batches():
    embedder = FakeEmbeddingProvider(dimensions=4)
    writer = FakeWriter()
    pipeline = DocumentIndexingPipeline(
        IndexingService(SourceRepository()),
        embedder,
        writer,
        vector_dimensions=4,
        batch_size=1,
    )

    report = await pipeline.index_document(21)

    assert report.generated_chunks == 2
    assert report.indexed_chunks == 2
    assert len(embedder.calls) == 2
    assert len(writer.calls) == 2
    assert all(len(chunks) == 1 for chunks, _ in writer.calls)
    assert writer.calls[1][0][0].embedding_text == "제1장\n본문"


@pytest.mark.asyncio
async def test_pipeline_rejects_wrong_embedding_dimensions_before_indexing():
    writer = FakeWriter()
    pipeline = DocumentIndexingPipeline(
        IndexingService(SourceRepository()),
        FakeEmbeddingProvider(dimensions=3),
        writer,
        vector_dimensions=4,
    )

    with pytest.raises(RuntimeError, match="dimension mismatch"):
        await pipeline.index_document(21)

    assert writer.calls == []
