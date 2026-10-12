from collections import defaultdict

from app.core.errors import AppError
from app.domain.models.viewer import ContentItem, Document, TocNode, ViewerContent
from app.domain.ports.document_repository import DocumentRepository


class ViewerService:
    def __init__(self, repository: DocumentRepository) -> None:
        self._repository = repository

    async def list_documents(self) -> list[Document]:
        return await self._repository.list_documents()

    async def get_document(self, document_id: int) -> Document:
        document = await self._repository.get_document(document_id)
        if document is None:
            raise AppError("DOCUMENT_NOT_FOUND", f"Document {document_id} was not found.", 404)
        return document

    async def list_contents(self, document_id: int, page: int | None = None) -> list[ViewerContent]:
        await self.get_document(document_id)
        items = await self._repository.list_contents(document_id)
        numbered = self._number_contents(items)
        if page is not None:
            numbered = [item for item in numbered if item.page == page]
        return numbered

    async def list_translation_languages(self, document_id: int) -> list[str]:
        await self.get_document(document_id)
        items = await self._repository.list_contents(document_id)
        languages: set[str] = set()
        for item in items:
            for code, translated in (item.translations or {}).items():
                if code and translated and translated.strip():
                    languages.add(code)
        return sorted(languages, key=str.casefold)

    async def get_content(self, document_id: int, content_id: int) -> ViewerContent:
        await self.get_document(document_id)
        item = await self._repository.get_content(document_id, content_id)
        if item is None:
            raise AppError("CONTENT_NOT_FOUND", f"Content {content_id} was not found in document {document_id}.", 404)
        contents = await self._repository.list_contents(document_id)
        numbers = {content.id: content.title_num for content in self._number_contents(contents)}
        return self._to_viewer_content(item, numbers.get(item.id))

    async def get_page_image_path(self, document_id: int, page: int) -> str:
        await self.get_document(document_id)
        path = await self._repository.get_page_image_path(document_id, page)
        if not path:
            raise AppError("PAGE_IMAGE_NOT_FOUND", f"Page image for document {document_id}, page {page} was not found.", 404)
        return path

    async def get_toc(self, document_id: int) -> list[TocNode]:
        await self.get_document(document_id)
        items = await self._repository.list_contents(document_id)
        numbered = self._number_contents(items)
        headings = [item for item in numbered if item.doc_level is not None and item.doc_level > 0 and item.text]
        return self._build_toc(headings)

    def _number_contents(self, items: list[ContentItem]) -> list[ViewerContent]:
        by_parent: dict[int | None, list[ContentItem]] = defaultdict(list)
        ids = {item.id for item in items}
        for item in items:
            parent = item.parent_id if item.parent_id in ids else None
            by_parent[parent].append(item)
        for siblings in by_parent.values():
            siblings.sort(key=lambda item: (item.order_index, item.id))

        numbers: dict[int, str | None] = {}
        visited: set[int] = set()

        def walk(parent_id: int | None, prefix: str | None) -> None:
            siblings = by_parent.get(parent_id, [])
            heading_position = 0
            for item in siblings:
                if item.id in visited:
                    continue
                visited.add(item.id)
                current_prefix = prefix
                if item.doc_level is not None and item.doc_level > 0:
                    heading_position += 1
                    if parent_id is None:
                        current_prefix = f"{heading_position}-0"
                    elif prefix:
                        current_prefix = f"{prefix}-{heading_position}"
                    else:
                        current_prefix = str(heading_position)
                    numbers[item.id] = current_prefix
                else:
                    numbers[item.id] = prefix
                walk(item.id, current_prefix)

        walk(None, None)
        for item in sorted(items, key=lambda row: (row.order_index, row.id)):
            if item.id not in visited:
                numbers[item.id] = None

        return [self._to_viewer_content(item, numbers.get(item.id)) for item in items]

    @staticmethod
    def _to_viewer_content(item: ContentItem, title_num: str | None) -> ViewerContent:
        return ViewerContent(
            id=item.id,
            document_id=item.document_id,
            text=item.text,
            content_type=item.content_type,
            doc_level=item.doc_level,
            parent_id=item.parent_id,
            order_index=item.order_index,
            page=item.page,
            cropped_image_path=item.cropped_image_path,
            bbox=item.bbox,
            title_num=title_num,
            doc_image_path=item.doc_image_path,
            translations=item.translations,
        )

    @staticmethod
    def _build_toc(headings: list[ViewerContent]) -> list[TocNode]:
        nodes = {
            item.id: TocNode(
                id=item.id,
                text=item.text or "",
                doc_level=item.doc_level or 0,
                title_num=item.title_num or "",
                page=item.page,
                order_index=item.order_index,
            )
            for item in headings
        }
        roots: list[TocNode] = []
        heading_ids = set(nodes)
        for item in headings:
            node = nodes[item.id]
            if item.parent_id in heading_ids:
                nodes[item.parent_id].children.append(node)
            else:
                roots.append(node)
        def sort_tree(group: list[TocNode]) -> None:
            group.sort(key=lambda node: (node.order_index, node.id))
            for node in group:
                sort_tree(node.children)
        sort_tree(roots)
        return roots
