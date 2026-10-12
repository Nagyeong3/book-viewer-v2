from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.application.index_management_service import IndexManagementService
from app.core.container import get_index_management_service

router = APIRouter(prefix="/api/indexing", tags=["indexing"])


class DocumentIndexStatusResponse(BaseModel):
    document_id: int
    state: str
    indexed_chunks: int
    message: str | None = None


@router.get("/documents", response_model=list[DocumentIndexStatusResponse])
async def list_document_index_status(
    document_ids: list[int] | None = Query(default=None),
    service: IndexManagementService = Depends(get_index_management_service),
):
    items = await service.statuses(document_ids)
    return [DocumentIndexStatusResponse(**asdict(item)) for item in items]


@router.get("/documents/{document_id}", response_model=DocumentIndexStatusResponse)
async def get_document_index_status(
    document_id: int,
    service: IndexManagementService = Depends(get_index_management_service),
):
    if document_id <= 0:
        raise HTTPException(status_code=400, detail="document_id must be positive")
    item = await service.status(document_id)
    return DocumentIndexStatusResponse(**asdict(item))


@router.post(
    "/documents/{document_id}",
    response_model=DocumentIndexStatusResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def build_document_index(
    document_id: int,
    service: IndexManagementService = Depends(get_index_management_service),
):
    if document_id <= 0:
        raise HTTPException(status_code=400, detail="document_id must be positive")
    item = await service.start_indexing(document_id)
    return DocumentIndexStatusResponse(**asdict(item))
