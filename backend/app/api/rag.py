from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import asdict

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app.application.rag_service import RagService
from app.core.container import get_rag_service
from app.domain.models.rag import RetrievalMode

router = APIRouter(prefix="/api/rag", tags=["rag"])


class RagQueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    document_ids: list[int] = Field(min_length=1, max_length=100)
    mode: RetrievalMode = "hybrid"
    top_k: int | None = Field(default=None, ge=1, le=50)

    @field_validator("document_ids")
    @classmethod
    def unique_document_ids(cls, value: list[int]) -> list[int]:
        if any(item <= 0 for item in value):
            raise ValueError("document_ids must contain positive integers")
        return list(dict.fromkeys(value))


class RagSourceResponse(BaseModel):
    source_id: str
    chunk_id: str
    document_id: int
    document_name: str
    content_id: int
    page: int | None
    title_path: list[str]
    text: str
    score: float


class RagQueryResponse(BaseModel):
    answer: str
    mode: RetrievalMode
    sources: list[RagSourceResponse]


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/query", response_model=RagQueryResponse)
async def query_rag(
    payload: RagQueryRequest,
    service: RagService = Depends(get_rag_service),
):
    result = await service.answer(
        payload.question,
        payload.document_ids,
        mode=payload.mode,
        top_k=payload.top_k,
    )
    return RagQueryResponse(
        answer=result.answer,
        mode=result.mode,
        sources=[
            RagSourceResponse(
                source_id=source.source_id,
                chunk_id=source.chunk_id,
                document_id=source.document_id,
                document_name=source.document_name,
                content_id=source.content_id,
                page=source.page,
                title_path=list(source.title_path),
                text=source.text,
                score=source.score,
            )
            for source in result.sources
        ],
    )


@router.post("/stream")
async def stream_rag(
    payload: RagQueryRequest,
    service: RagService = Depends(get_rag_service),
) -> StreamingResponse:
    async def events() -> AsyncIterator[str]:
        async for event, data in service.stream_answer(
            payload.question,
            payload.document_ids,
            mode=payload.mode,
            top_k=payload.top_k,
        ):
            if event == "sources":
                yield _sse("sources", [asdict(source) for source in data])
            else:
                yield _sse(event, data)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
