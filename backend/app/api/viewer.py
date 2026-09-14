from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict

from app.application.viewer_service import ViewerService
from app.core.container import get_viewer_service

router = APIRouter(prefix="/api/documents", tags=["viewer"])


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str


class BoundingBoxResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    xmin: float
    ymin: float
    xmax: float
    ymax: float


class ContentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    document_id: int
    text: str | None
    content_type: str | None
    doc_level: int | None
    parent_id: int | None
    order_index: int
    page: int | None
    cropped_image_path: str | None
    bbox: BoundingBoxResponse | None
    title_num: str | None


class TocNodeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    doc_level: int
    title_num: str
    page: int | None
    order_index: int
    children: list["TocNodeResponse"]


@router.get("", response_model=list[DocumentResponse])
async def list_documents(service: ViewerService = Depends(get_viewer_service)):
    return await service.list_documents()


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: int, service: ViewerService = Depends(get_viewer_service)):
    return await service.get_document(document_id)


@router.get("/{document_id}/toc", response_model=list[TocNodeResponse])
async def get_toc(document_id: int, service: ViewerService = Depends(get_viewer_service)):
    return await service.get_toc(document_id)


@router.get("/{document_id}/contents", response_model=list[ContentResponse])
async def list_contents(
    document_id: int,
    page: int | None = Query(default=None, ge=1),
    service: ViewerService = Depends(get_viewer_service),
):
    return await service.list_contents(document_id, page=page)


@router.get("/{document_id}/contents/{content_id}", response_model=ContentResponse)
async def get_content(
    document_id: int,
    content_id: int,
    service: ViewerService = Depends(get_viewer_service),
):
    return await service.get_content(document_id, content_id)
