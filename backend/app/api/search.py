from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from app.application.retrieval_service import RetrievalService
from app.core.container import get_retrieval_service
from app.domain.models.rag import RetrievalMode

router = APIRouter(prefix="/api/search", tags=["search"])


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    document_ids: list[int] = Field(min_length=1, max_length=100)
    mode: RetrievalMode = "hybrid"
    top_k: int = Field(default=8, ge=1, le=50)

    @field_validator("document_ids")
    @classmethod
    def validate_document_ids(cls, value: list[int]) -> list[int]:
        if any(item <= 0 for item in value):
            raise ValueError("document_ids must contain positive integers")
        return list(dict.fromkeys(value))


class SearchHitResponse(BaseModel):
    chunk_id: str
    document_id: int
    document_name: str
    content_id: int
    text: str
    title_path: list[str]
    page: int | None
    content_type: str | None
    score: float
    keyword_score: float | None
    vector_score: float | None


@router.post("", response_model=list[SearchHitResponse])
async def search(
    payload: SearchRequest,
    service: RetrievalService = Depends(get_retrieval_service),
):
    hits = await service.search(
        payload.query,
        payload.document_ids,
        mode=payload.mode,
        top_k=payload.top_k,
    )
    return [
        SearchHitResponse(
            chunk_id=hit.chunk_id,
            document_id=hit.document_id,
            document_name=hit.document_name,
            content_id=hit.content_id,
            text=hit.text,
            title_path=list(hit.title_path),
            page=hit.page,
            content_type=hit.content_type,
            score=hit.score,
            keyword_score=hit.keyword_score,
            vector_score=hit.vector_score,
        )
        for hit in hits
    ]
