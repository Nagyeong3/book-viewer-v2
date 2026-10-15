from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import httpx


UserRole = Literal["user", "admin"]


class AuthenticationError(RuntimeError):
    pass


class AuthorizationError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    id: str
    username: str
    name: str
    role: UserRole
    groups: tuple[str, ...]


class KeycloakAuthProvider:
    def __init__(
        self,
        base_url: str,
        realm: str,
        client_id: str,
        user_group: str,
        admin_group: str,
        timeout: float = 10.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._realm = realm
        self._client_id = client_id
        self._user_group = user_group
        self._admin_group = admin_group
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout)

    @property
    def userinfo_url(self) -> str:
        return f"{self._base_url}/realms/{self._realm}/protocol/openid-connect/userinfo"

    async def authenticate(self, access_token: str) -> AuthenticatedUser:
        try:
            response = await self._client.get(
                self.userinfo_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
        except httpx.HTTPError as exc:
            raise AuthenticationError("Keycloak userinfo endpoint is unavailable") from exc

        if response.status_code != 200:
            raise AuthenticationError("Access token is invalid or expired")

        try:
            payload = response.json()
        except ValueError as exc:
            raise AuthenticationError("Keycloak returned an invalid userinfo response") from exc

        groups_value = payload.get("groups", [])
        groups = tuple(item for item in groups_value if isinstance(item, str)) if isinstance(groups_value, list) else ()

        if self._admin_group in groups:
            role: UserRole = "admin"
        elif self._user_group in groups:
            role = "user"
        else:
            raise AuthorizationError("This account is not assigned to the Book Viewer user group")

        subject = payload.get("sub")
        username = payload.get("preferred_username") or payload.get("email") or subject
        name = payload.get("name") or username
        if not isinstance(subject, str) or not subject:
            raise AuthenticationError("Keycloak userinfo response does not contain a subject")
        if not isinstance(username, str) or not username:
            username = subject
        if not isinstance(name, str) or not name:
            name = username

        return AuthenticatedUser(
            id=subject,
            username=username,
            name=name,
            role=role,
            groups=groups,
        )

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()
