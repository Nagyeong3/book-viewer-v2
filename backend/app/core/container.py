from dataclasses import dataclass

from fastapi import Request

from app.core.config import Settings


@dataclass(frozen=True, slots=True)
class AppContainer:
    settings: Settings


def get_container(request: Request) -> AppContainer:
    container = getattr(request.app.state, "container", None)
    if not isinstance(container, AppContainer):
        raise RuntimeError("Application container is not initialized")
    return container
