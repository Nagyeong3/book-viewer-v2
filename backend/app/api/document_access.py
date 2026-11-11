from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.api.auth import require_admin
from app.application.document_access_service import DocumentAccessService
from app.core.container import get_document_access_service
from app.infrastructure.auth.keycloak import AuthenticatedUser

router = APIRouter(prefix="/api/document-access", tags=["document-access"])


class DocumentPolicy(BaseModel):
    document_id: int
    title: str
    groups: list[str]
    users: list[str]


class PolicyUpdate(BaseModel):
    groups: list[str] = Field(default_factory=list, max_length=100)
    users: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("groups", "users")
    @classmethod
    def normalize(cls, items: list[str]) -> list[str]:
        normalized = [item.strip() for item in items]
        if any(not item or len(item) > 200 for item in normalized):
            raise ValueError("Group paths and user IDs must be between 1 and 200 characters")
        return sorted(set(normalized))

    @field_validator("groups")
    @classmethod
    def check_group_path(cls, groups: list[str]) -> list[str]:
        if any(not group.startswith("/") for group in groups):
            raise ValueError("Keycloak group paths must start with /")
        return groups


@router.get("", response_model=list[DocumentPolicy])
async def list_policies(
    admin: AuthenticatedUser = Depends(require_admin),
    service: DocumentAccessService = Depends(get_document_access_service),
):
    return await service.get_policies()


@router.put("/{document_id}", response_model=DocumentPolicy)
async def set_policy(
    document_id: int,
    payload: PolicyUpdate,
    admin: AuthenticatedUser = Depends(require_admin),
    service: DocumentAccessService = Depends(get_document_access_service),
):
    if document_id <= 0:
        raise HTTPException(status_code=400, detail="document_id must be positive")
    await service.replace_policy(document_id, admin.id, payload.groups, payload.users)
    policies = await service.get_policies()
    return next(policy for policy in policies if policy["document_id"] == document_id)
