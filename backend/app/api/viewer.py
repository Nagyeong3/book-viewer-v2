from urllib.parse import urljoin, urlparse

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict

from app.application.viewer_service import ViewerService
from app.core.config import Settings, get_settings
from app.core.container import get_viewer_service
from app.core.errors import AppError

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
    doc_image_path: str | None
    bbox: BoundingBoxResponse | None
    title_num: str | None
    translations: dict[str, str] | None = None


class TocNodeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    doc_level: int
    title_num: str
    page: int | None
    order_index: int
    children: list["TocNodeResponse"]


def _resolve_page_image_url(path: str, filer_url: str | None) -> str:
    parsed = urlparse(path)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return path
    if not filer_url:
        raise AppError(
            "SEAWEEDFS_FILER_URL_NOT_CONFIGURED",
            "SEAWEEDFS_FILER_URL is required to resolve document image paths.",
            500,
        )
    return urljoin(filer_url.rstrip("/") + "/", path.lstrip("/"))


@router.get("", response_model=list[DocumentResponse])
async def list_documents(service: ViewerService = Depends(get_viewer_service)):
    return await service.list_documents()


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: int, service: ViewerService = Depends(get_viewer_service)):
    return await service.get_document(document_id)


@router.get("/{document_id}/toc", response_model=list[TocNodeResponse])
async def get_toc(document_id: int, service: ViewerService = Depends(get_viewer_service)):
    return await service.get_toc(document_id)


@router.get("/{document_id}/translation-languages", response_model=list[str])
async def list_translation_languages(
    document_id: int,
    service: ViewerService = Depends(get_viewer_service),
):
    return await service.list_translation_languages(document_id)


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


@router.get("/{document_id}/pages/{page}/image")
async def get_page_image(
    document_id: int,
    page: int,
    service: ViewerService = Depends(get_viewer_service),
    settings: Settings = Depends(get_settings),
):
    path = await service.get_page_image_path(document_id, page)
    target = _resolve_page_image_url(path, settings.seaweedfs_filer_url)
    return RedirectResponse(target, status_code=307)
