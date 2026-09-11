import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.errors import register_exception_handlers
from app.api.health import router as health_router
from app.api.middleware import register_request_middleware
from app.core.config import Settings, get_settings
from app.core.container import AppContainer
from app.core.logging import configure_logging

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    configure_logging(resolved_settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.container = AppContainer(settings=resolved_settings)
        logger.info("Application startup")
        try:
            yield
        finally:
            logger.info("Application shutdown")

    app = FastAPI(
        title=resolved_settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
    )
    register_request_middleware(app)
    register_exception_handlers(app)
    app.include_router(health_router)
    return app


app = create_app()
