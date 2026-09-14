from app.domain.models.viewer import BoundingBox, ContentItem, Document


class FakeDocumentRepository:
    def __init__(self) -> None:
        self.documents = [Document(id=1, title="Manual A"), Document(id=2, title="Manual B")]
        self.contents = [
            ContentItem(10, 1, "Chapter 1", "title", 1, None, 1, 1, None, BoundingBox(0, 0, 100, 20)),
            ContentItem(11, 1, "Body 1", "text", None, 10, 2, 1, None, BoundingBox(0, 20, 100, 50)),
            ContentItem(12, 1, "Section A", "title", 2, 10, 3, 2, None, BoundingBox(0, 0, 100, 20)),
            ContentItem(13, 1, "Section B", "title", 2, 10, 4, 3, "crop.png", None),
            ContentItem(14, 1, "Chapter 2", "title", 1, None, 5, 4, None, None),
            ContentItem(15, 1, "Body 2", "text", None, 14, 6, 4, None, None),
        ]

    async def list_documents(self):
        return list(self.documents)

    async def get_document(self, document_id: int):
        return next((d for d in self.documents if d.id == document_id), None)

    async def list_contents(self, document_id: int):
        return [c for c in self.contents if c.document_id == document_id]

    async def get_content(self, document_id: int, content_id: int):
        return next((c for c in self.contents if c.document_id == document_id and c.id == content_id), None)
