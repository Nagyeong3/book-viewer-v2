from __future__ import annotations

from dataclasses import dataclass

from app.domain.models.rag import RagSource, RetrievedChunk


@dataclass(frozen=True, slots=True)
class BuiltContext:
    text: str
    sources: tuple[RagSource, ...]


class ContextBuilder:
    def __init__(self, *, max_chars: int = 24000) -> None:
        if max_chars < 1000:
            raise ValueError("max_chars must be >= 1000")
        self._max_chars = max_chars

    def build(self, hits: list[RetrievedChunk]) -> BuiltContext:
        blocks: list[str] = []
        sources: list[RagSource] = []
        used = 0

        for index, hit in enumerate(hits, start=1):
            source_id = f"S{index}"
            title = hit.title or "(제목 없음)"
            page = str(hit.page) if hit.page is not None else "?"
            block = (
                f"[{source_id}] 문서={hit.document_name} 문서ID={hit.document_id} "
                f"페이지={page} 제목={title}\n{hit.text.strip()}"
            )
            extra = len(block) + (2 if blocks else 0)
            if blocks and used + extra > self._max_chars:
                break
            if not blocks and extra > self._max_chars:
                block = block[: self._max_chars]
                extra = len(block)
            blocks.append(block)
            used += extra
            sources.append(
                RagSource(
                    source_id=source_id,
                    chunk_id=hit.chunk_id,
                    document_id=hit.document_id,
                    document_name=hit.document_name,
                    content_id=hit.content_id,
                    page=hit.page,
                    title_path=hit.title_path,
                    text=hit.text,
                    score=hit.score,
                )
            )
        return BuiltContext(text="\n\n".join(blocks), sources=tuple(sources))
