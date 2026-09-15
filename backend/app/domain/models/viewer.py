from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class Document:
    id: int
    title: str


@dataclass(frozen=True, slots=True)
class BoundingBox:
    xmin: float
    ymin: float
    xmax: float
    ymax: float


@dataclass(frozen=True, slots=True)
class ContentItem:
    id: int
    document_id: int
    text: str | None
    content_type: str | None
    doc_level: int | None
    parent_id: int | None
    order_index: int
    page: int | None
    cropped_image_path: str | None
    bbox: BoundingBox | None
    doc_image_path: str | None = None


@dataclass(slots=True)
class ViewerContent:
    id: int
    document_id: int
    text: str | None
    content_type: str | None
    doc_level: int | None
    parent_id: int | None
    order_index: int
    page: int | None
    cropped_image_path: str | None
    bbox: BoundingBox | None
    title_num: str | None = None
    doc_image_path: str | None = None


@dataclass(slots=True)
class TocNode:
    id: int
    text: str
    doc_level: int
    title_num: str
    page: int | None
    order_index: int
    children: list["TocNode"] = field(default_factory=list)
