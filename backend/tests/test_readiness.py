from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.container import AppContainer
from app.main import create_app


class PingPool:
    def __init__(self, result=True):
        self.result = result
        self.closed = False
    async def ping(self):
        return self.result
    async def close(self):
        self.closed = True


async def no_db(settings):
    return AppContainer(settings=settings)


def test_ready_without_database_returns_503() -> None:
    app = create_app(Settings(app_env="test"), container_factory=no_db)
    with TestClient(app) as client:
        response = client.get("/ready")
    assert response.status_code == 503
    assert response.json()["database"] == "not_configured"


def test_ready_with_database_returns_200_and_closes_pool() -> None:
    pool = PingPool()
    async def factory(settings):
        return AppContainer(settings=settings, postgres_pool=pool)
    app = create_app(Settings(app_env="test"), container_factory=factory)
    with TestClient(app) as client:
        response = client.get("/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ready", "database": "ok"}
    assert pool.closed is True
