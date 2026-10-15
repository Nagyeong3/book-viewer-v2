from __future__ import annotations

import base64
import json
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


def _token_client_ids(access_token: str) -> set[str]:
    try:
        payload_part = access_token.split(".")[1]
        padded = payload_part + "=" * (-len(payload_part) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    except (IndexError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AuthenticationError("Access token has an invalid JWT payload") from exc

    client_ids: set[str] = set()
    azp = payload.get("azp")
    if isinstance(azp, str):
        client_ids.add(azp)
    audience = payload.get("aud")
    if isinstance(audience, str):
        client_ids.add(audience)
    elif isinstance(audience, list):
        client_ids.update(item for item in audience if isinstance(item, str))
    return client_ids


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

        if self._client_id not in _token_client_ids(access_token):
            raise AuthenticationError("Access token was not issued for the Book Viewer client")

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
