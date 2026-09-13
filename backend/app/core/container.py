from dataclasses import dataclass
from fastapi import Request

from app.application.viewer_service import ViewerService
from app.core.config import Settings
from app.infrastructure.postgres.document_repository import PostgresDocumentRepository
from app.infrastructure.postgres.pool import PostgresPool


@dataclass(slots=True)
class AppContainer:
    settings: Settings
    postgres_pool: PostgresPool | None = None
    viewer_service: ViewerService | None = None

    @classmethod
    async def start(cls, settings: Settings) -> "AppContainer":
        container = cls(settings=settings)
        if settings.database_url:
            pool = await PostgresPool.connect(
                settings.database_url,
                min_size=settings.database_min_pool_size,
                max_size=settings.database_max_pool_size,
                command_timeout=settings.database_command_timeout,
            )
            container.postgres_pool = pool
            container.viewer_service = ViewerService(PostgresDocumentRepository(pool))
        return container

    async def close(self) -> None:
        if self.postgres_pool is not None:
            await self.postgres_pool.close()


def get_container(request: Request) -> AppContainer:
    container = getattr(request.app.state, "container", None)
    if not isinstance(container, AppContainer):
        raise RuntimeError("Application container is not initialized")
    return container


def get_viewer_service(request: Request) -> ViewerService:
    container = get_container(request)
    if container.viewer_service is None:
        raise RuntimeError("Viewer service is unavailable because DATABASE_URL is not configured")
    return container.viewer_service
