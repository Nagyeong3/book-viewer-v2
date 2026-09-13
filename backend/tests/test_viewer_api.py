from fastapi.testclient import TestClient

from app.application.viewer_service import ViewerService
from app.core.config import Settings
from app.core.container import AppContainer
from app.main import create_app
from tests.fakes import FakeDocumentRepository


async def fake_container_factory(settings: Settings) -> AppContainer:
    return AppContainer(settings=settings, viewer_service=ViewerService(FakeDocumentRepository()))


def client() -> TestClient:
    return TestClient(create_app(Settings(app_env="test"), container_factory=fake_container_factory))


def test_viewer_endpoints() -> None:
    with client() as test_client:
        documents = test_client.get("/api/documents")
        assert documents.status_code == 200
        assert len(documents.json()) == 2

        document = test_client.get("/api/documents/1")
        assert document.json() == {"id": 1, "title": "Manual A"}

        toc = test_client.get("/api/documents/1/toc")
        assert toc.status_code == 200
        assert toc.json()[0]["title_num"] == "1-0"
        assert toc.json()[0]["children"][0]["title_num"] == "1-0-1"

        contents = test_client.get("/api/documents/1/contents?page=4")
        assert [item["id"] for item in contents.json()] == [14, 15]

        content = test_client.get("/api/documents/1/contents/13")
        assert content.status_code == 200
        assert content.json()["bbox"] is None
        assert content.json()["title_num"] == "1-0-2"


def test_viewer_404_contract() -> None:
    with client() as test_client:
        response = test_client.get("/api/documents/999")
    assert response.status_code == 404
    assert response.json()["code"] == "DOCUMENT_NOT_FOUND"
    assert response.json()["request_id"] == response.headers["X-Request-ID"]


def test_invalid_page_uses_standard_validation_contract() -> None:
    with client() as test_client:
        response = test_client.get("/api/documents/1/contents?page=0")
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
