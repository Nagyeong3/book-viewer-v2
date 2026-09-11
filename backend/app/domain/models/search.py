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
