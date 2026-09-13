from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

from app.core.container import AppContainer, get_container
from app.main import create_app


def test_container_is_available_through_dependency() -> None:
    app = create_app()
    router = APIRouter()

    @router.get("/container")
    async def container_endpoint(
        container: AppContainer = Depends(get_container),
    ) -> dict[str, str]:
        return {"app_name": container.settings.app_name}

    app.include_router(router)

    with TestClient(app) as client:
        response = client.get("/container")

    assert response.status_code == 200
    assert response.json() == {"app_name": "Book Viewer V2"}
