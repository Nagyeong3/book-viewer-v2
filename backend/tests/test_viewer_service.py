import pytest

from app.application.viewer_service import ViewerService
from app.core.errors import AppError
from tests.fakes import FakeDocumentRepository


@pytest.fixture
def service() -> ViewerService:
    return ViewerService(FakeDocumentRepository())


@pytest.mark.asyncio
async def test_list_documents(service: ViewerService) -> None:
    documents = await service.list_documents()
    assert [d.title for d in documents] == ["Manual A", "Manual B"]


@pytest.mark.asyncio
async def test_document_not_found(service: ViewerService) -> None:
    with pytest.raises(AppError) as exc:
        await service.get_document(999)
    assert exc.value.status_code == 404
    assert exc.value.code == "DOCUMENT_NOT_FOUND"


@pytest.mark.asyncio
async def test_content_numbering_and_page_filter(service: ViewerService) -> None:
    contents = await service.list_contents(1)
    nums = {item.id: item.title_num for item in contents}
    assert nums[10] == "1-0"
    assert nums[11] == "1-0"
    assert nums[12] == "1-0-1"
    assert nums[13] == "1-0-2"
    assert nums[14] == "2-0"
    assert nums[15] == "2-0"

    page_four = await service.list_contents(1, page=4)
    assert [item.id for item in page_four] == [14, 15]


@pytest.mark.asyncio
async def test_toc_tree(service: ViewerService) -> None:
    toc = await service.get_toc(1)
    assert [node.id for node in toc] == [10, 14]
    assert [node.id for node in toc[0].children] == [12, 13]
    assert toc[0].children[1].title_num == "1-0-2"


@pytest.mark.asyncio
async def test_get_content_includes_navigation_number(service: ViewerService) -> None:
    content = await service.get_content(1, 13)
    assert content.title_num == "1-0-2"
    assert content.cropped_image_path == "crop.png"


@pytest.mark.asyncio
async def test_content_not_found_is_scoped_to_document(service: ViewerService) -> None:
    with pytest.raises(AppError) as exc:
        await service.get_content(2, 13)
    assert exc.value.code == "CONTENT_NOT_FOUND"
