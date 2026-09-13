from fastapi import APIRouter
from fastapi.testclient import TestClient

from app.core.errors import AppError
from app.main import create_app


def test_app_error_contract_includes_request_id() -> None:
    app = create_app()
    router = APIRouter()

    @router.get("/boom")
    async def boom() -> None:
        raise AppError(code="TEST_ERROR", message="boom", status_code=409)

    app.include_router(router)

    with TestClient(app) as client:
        response = client.get("/boom", headers={"X-Request-ID": "req-error-1"})

    assert response.status_code == 409
    assert response.json() == {
        "code": "TEST_ERROR",
        "message": "boom",
        "request_id": "req-error-1",
        "details": None,
    }


def test_validation_error_uses_standard_contract() -> None:
    app = create_app()
    router = APIRouter()

    @router.get("/items/{item_id}")
    async def item(item_id: int) -> dict[str, int]:
        return {"item_id": item_id}

    app.include_router(router)

    with TestClient(app) as client:
        response = client.get("/items/not-an-int")

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert body["request_id"] == response.headers["X-Request-ID"]
    assert body["details"]
