"""Document ACL checks must fail closed even when the caller supplies arbitrary IDs."""
import asyncio

import pytest
from fastapi import HTTPException

from app.api.document_access import PolicyUpdate
from app.application.document_access_service import DocumentAccessService
from app.infrastructure.auth.keycloak import AuthenticatedUser


class FakePool:
    def __init__(self):
        self.documents = [101, 102, 103]
        self.group_grants = {101: "/teams/ips", 102: "/teams/ate"}
        self.user_grants = {103: "user-a"}

    async def fetch(self, query, *args):
        if query.strip() == "SELECT id FROM documents":
            return [{"id": value} for value in self.documents]
        if "document_access_users" in query and "UNION" in query:
            user_id, groups = args
            ids = {d for d, subject in self.user_grants.items() if subject == user_id}
            ids.update(d for d, group in self.group_grants.items() if group in groups)
            return [{"id": item} for item in sorted(ids)]
        raise AssertionError(f"Unexpected query: {query}")


def user(subject="user-a", groups=("/teams/ips",), role="user"):
    return AuthenticatedUser(
        id=subject, username=subject, name=subject, role=role, groups=groups
    )


def test_group_and_user_grants_are_combined():
    service = DocumentAccessService(FakePool())
    assert asyncio.run(service.allowed_document_ids(user())) == {101, 103}
    assert asyncio.run(service.allowed_document_ids(user("user-b", ("/teams/ate",)))) == {102}


def test_document_scope_rejects_even_one_unauthorized_document():
    service = DocumentAccessService(FakePool())
    asyncio.run(service.require_documents(user(), [101, 103]))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(service.require_documents(user(), [101, 102]))
    assert exc.value.status_code == 403


def test_admin_can_access_all_documents():
    service = DocumentAccessService(FakePool())
    admin = user("admin", ("/teams/ips/admins",), role="admin")
    assert asyncio.run(service.allowed_document_ids(admin)) == {101, 102, 103}
    asyncio.run(service.require_documents(admin, [101, 102, 103]))


def test_policy_update_rejects_unqualified_group_paths():
    with pytest.raises(ValueError):
        PolicyUpdate(groups=["teams/ips"], users=[])
    assert PolicyUpdate(groups=[" /teams/ips ", "/teams/ips"], users=[]).groups == ["/teams/ips"]


def test_admin_policy_put_cors_preflight():
    from fastapi.testclient import TestClient
    from app.core.config import Settings
    from app.main import create_app

    app = create_app(Settings(app_env="test", cors_allowed_origins="http://example.test"))
    with TestClient(app) as client:
        response = client.options(
            "/api/document-access/101",
            headers={
                "Origin": "http://example.test",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://example.test"
