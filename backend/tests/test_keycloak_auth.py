import base64
import json

import httpx
import pytest

from app.infrastructure.auth.keycloak import AuthenticationError, AuthorizationError, KeycloakAuthProvider


def access_token(client_id: str = "book-viewer-v2") -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps({"azp": client_id}).encode()).decode().rstrip("=")
    return f"{header}.{payload}.signature"


@pytest.mark.asyncio
async def test_keycloak_auth_maps_admin_group() -> None:
    token = access_token()

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == f"Bearer {token}"
        return httpx.Response(
            200,
            json={
                "sub": "u-1",
                "preferred_username": "admin.user",
                "name": "Admin User",
                "groups": [
                    "/teams/ips-260703-test",
                    "/teams/ips-260703-test/admins",
                ],
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = KeycloakAuthProvider(
        "http://keycloak:4420",
        realm="kai",
        client_id="book-viewer-v2",
        user_group="/teams/ips-260703-test",
        admin_group="/teams/ips-260703-test/admins",
        client=client,
    )
    user = await provider.authenticate(token)
    assert user.role == "admin"
    assert user.username == "admin.user"
    await client.aclose()


@pytest.mark.asyncio
async def test_keycloak_auth_maps_regular_user_group() -> None:
    token = access_token()

    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "sub": "u-2",
                "preferred_username": "viewer.user",
                "groups": ["/teams/ips-260703-test"],
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = KeycloakAuthProvider(
        "http://keycloak:4420",
        realm="kai",
        client_id="book-viewer-v2",
        user_group="/teams/ips-260703-test",
        admin_group="/teams/ips-260703-test/admins",
        client=client,
    )
    user = await provider.authenticate(token)
    assert user.role == "user"
    await client.aclose()


@pytest.mark.asyncio
async def test_keycloak_auth_rejects_user_outside_viewer_groups() -> None:
    token = access_token()

    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"sub": "u-3", "groups": ["/other-team"]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = KeycloakAuthProvider(
        "http://keycloak:4420",
        realm="kai",
        client_id="book-viewer-v2",
        user_group="/teams/ips-260703-test",
        admin_group="/teams/ips-260703-test/admins",
        client=client,
    )
    with pytest.raises(AuthorizationError):
        await provider.authenticate(token)
    await client.aclose()


@pytest.mark.asyncio
async def test_keycloak_auth_rejects_token_for_other_client() -> None:
    token = access_token("other-client")

    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"sub": "u-4", "groups": ["/teams/ips-260703-test"]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = KeycloakAuthProvider(
        "http://keycloak:4420",
        realm="kai",
        client_id="book-viewer-v2",
        user_group="/teams/ips-260703-test",
        admin_group="/teams/ips-260703-test/admins",
        client=client,
    )
    with pytest.raises(AuthenticationError):
        await provider.authenticate(token)
    await client.aclose()
