from fastapi import APIRouter
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.container import AppContainer
from app.core.errors import AppError
from app.main import create_app


async def factory(settings):
    return AppContainer(settings=settings)


def test_health_and_request_id() -> None:
    app = create_app(Settings(app_env="test"), container_factory=factory)
    with TestClient(app) as client:
        response = client.get("/health", headers={"X-Request-ID": "req-123"})
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-ID"] == "req-123"


def test_app_error_contract() -> None:
    app = create_app(Settings(app_env="test"), container_factory=factory)
    router = APIRouter()
    @router.get("/boom")
    async def boom():
        raise AppError("TEST_ERROR", "boom", 409)
    app.include_router(router)
    with TestClient(app) as client:
        response = client.get("/boom")
    assert response.status_code == 409
    assert response.json()["code"] == "TEST_ERROR"
