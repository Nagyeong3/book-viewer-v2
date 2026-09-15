import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.errors import register_exception_handlers
from app.api.health import router as health_router
from app.api.middleware import register_request_middleware
from app.api.rag import router as rag_router
from app.api.readiness import router as readiness_router
from app.api.viewer import router as viewer_router
from app.core.config import Settings, get_settings
from app.core.container import AppContainer
from app.core.logging import configure_logging

logger = logging.getLogger(__name__)
ContainerFactory = Callable[[Settings], Awaitable[AppContainer]]


def create_app(
    settings: Settings | None = None,
    container_factory: ContainerFactory = AppContainer.start,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    configure_logging(resolved_settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        container = await container_factory(resolved_settings)
        app.state.container = container
        logger.info("Application startup")
        try:
            yield
        finally:
            await container.close()
            logger.info("Application shutdown")

    app = FastAPI(
        title=resolved_settings.app_name,
        version="0.5.0",
        lifespan=lifespan,
        docs_url="/docs" if resolved_settings.enable_api_docs else None,
        redoc_url=None,
    )
    register_request_middleware(app)
    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(readiness_router)
    app.include_router(viewer_router)
    app.include_router(rag_router)
    return app


app = create_app()
