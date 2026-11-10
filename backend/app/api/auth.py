from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core.container import get_container
from app.infrastructure.auth.keycloak import (
    AuthenticatedUser,
    AuthenticationError,
    AuthorizationError,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)


class CurrentUserResponse(BaseModel):
    id: str
    username: str
    name: str
    role: str
    groups: list[str]


async def require_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> AuthenticatedUser:
    container = get_container(request)
    settings = container.settings

    if settings.auth_mode == "disabled":
        return AuthenticatedUser(
            id="auth-disabled",
            username="auth-disabled",
            name="Authentication Disabled",
            role="admin",
            groups=(settings.keycloak_admin_group or "/admin",),
        )

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer access token is required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    provider = container.auth_provider
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Keycloak authentication is not configured",
        )

    try:
        return await provider.authenticate(credentials.credentials)
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except AuthorizationError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


async def require_admin(user: AuthenticatedUser = Depends(require_user)) -> AuthenticatedUser:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator permission is required")
    return user


@router.get("/me", response_model=CurrentUserResponse)
async def current_user(user: AuthenticatedUser = Depends(require_user)) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=user.id,
        username=user.username,
        name=user.name,
        role=user.role,
        groups=list(user.groups),
    )
