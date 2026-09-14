from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class SearchScope:
    document_ids: tuple[str, ...] = ()
    project: str | None = None
    document_types: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RetrievalResult:
    document_id: str
    chunk_id: str
    text: str
    title: str = ""
    page: int | None = None
    score: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class IndexSourceContent:
    id: int
    document_id: int
    document_name: str
    parent_id: int | None
    order_index: int
    level: int | None
    page: int | None
    content_type: str | None
    text: str | None
    doc_image_path: str | None
    cropped_image_path: str | None
    x_min: int | None
    y_min: int | None
    x_max: int | None
    y_max: int | None


@dataclass(frozen=True, slots=True)
class SearchChunk:
    id: str
    document_id: int
    document_name: str
    content_id: int
    parent_id: int | None
    order_index: int
    level: int | None
    page: int | None
    content_type: str | None
    text: str
    title_path: tuple[str, ...]
    doc_image_path: str | None
    cropped_image_path: str | None
    x_min: int | None
    y_min: int | None
    x_max: int | None
    y_max: int | None

    @property
    def embedding_text(self) -> str:
        parts = list(self.title_path)
        if not parts or parts[-1].strip() != self.text.strip():
            parts.append(self.text)
        return "\n".join(part.strip() for part in parts if part and part.strip())

    def to_index_document(self, *, vector: list[float] | None = None) -> dict[str, object]:
        document: dict[str, object] = {
            "document_id": self.document_id,
            "document_name": self.document_name,
            "content_id": self.content_id,
            "parent_id": self.parent_id,
            "order_index": self.order_index,
            "level": self.level,
            "page": self.page,
            "content_type": self.content_type,
            "text": self.text,
            "title_path": list(self.title_path),
            "doc_image_path": self.doc_image_path,
            "cropped_image_path": self.cropped_image_path,
            "x_min": self.x_min,
            "y_min": self.y_min,
            "x_max": self.x_max,
            "y_max": self.y_max,
        }
        if vector is not None:
            document["vector"] = vector
        return document
