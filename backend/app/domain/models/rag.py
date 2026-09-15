from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

RetrievalMode = Literal["keyword", "vector", "hybrid"]
AgentToolName = Literal["full_text_search", "vector_search", "hybrid_search", "title_search"]


@dataclass(frozen=True, slots=True)
class RetrievedChunk:
    chunk_id: str
    document_id: int
    document_name: str
    content_id: int
    text: str
    title_path: tuple[str, ...]
    page: int | None
    content_type: str | None
    score: float
    keyword_score: float | None = None
    vector_score: float | None = None

    @property
    def title(self) -> str:
        return " > ".join(part for part in self.title_path if part)


@dataclass(frozen=True, slots=True)
class RagSource:
    source_id: str
    chunk_id: str
    document_id: int
    document_name: str
    content_id: int
    page: int | None
    title_path: tuple[str, ...]
    text: str
    score: float


@dataclass(frozen=True, slots=True)
class RagAnswer:
    answer: str
    mode: RetrievalMode
    sources: tuple[RagSource, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class AgentPlan:
    tool: AgentToolName
    query: str
    top_k: int
    rationale: str = ""


@dataclass(frozen=True, slots=True)
class AgentAnswer:
    answer: str
    plan: AgentPlan
    sources: tuple[RagSource, ...] = field(default_factory=tuple)
