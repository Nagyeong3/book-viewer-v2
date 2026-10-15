import httpx
import pytest

from app.infrastructure.auth.keycloak import AuthorizationError, KeycloakAuthProvider


@pytest.mark.asyncio
async def test_keycloak_auth_maps_admin_group() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer token"
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
    user = await provider.authenticate("token")
    assert user.role == "admin"
    assert user.username == "admin.user"
    await client.aclose()


@pytest.mark.asyncio
async def test_keycloak_auth_maps_regular_user_group() -> None:
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
    user = await provider.authenticate("token")
    assert user.role == "user"
    await client.aclose()


@pytest.mark.asyncio
async def test_keycloak_auth_rejects_user_outside_viewer_groups() -> None:
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
        await provider.authenticate("token")
    await client.aclose()
