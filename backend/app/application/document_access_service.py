from __future__ import annotations

import json

from fastapi import HTTPException

from app.infrastructure.auth.keycloak import AuthenticatedUser
from app.infrastructure.postgres.pool import PostgresPool


class DocumentAccessService:
    """PostgreSQL ACL; absence of a grant means deny for ordinary users."""

    def __init__(self, pool: PostgresPool) -> None:
        self.pool = pool

    async def allowed_document_ids(self, user: AuthenticatedUser) -> set[int]:
        if user.role == "admin":
            rows = await self.pool.fetch("SELECT id FROM documents")
        else:
            rows = await self.pool.fetch(
                """
                SELECT document_id AS id FROM document_access_users
                WHERE keycloak_user_id = $1
                UNION
                SELECT document_id AS id FROM document_access_groups
                WHERE group_path = ANY($2::text[])
                """,
                user.id, list(user.groups),
            )
        return {int(row["id"]) for row in rows}

    async def require_documents(self, user: AuthenticatedUser, document_ids: list[int]) -> None:
        if user.role == "admin":
            return
        if not set(document_ids).issubset(await self.allowed_document_ids(user)):
            raise HTTPException(status_code=403, detail="You do not have permission to access one or more requested documents")

    async def get_policies(self) -> list[dict]:
        documents = await self.pool.fetch("SELECT id, name AS title FROM documents ORDER BY id")
        groups = await self.pool.fetch("SELECT document_id, group_path FROM document_access_groups ORDER BY group_path")
        users = await self.pool.fetch("SELECT document_id, keycloak_user_id FROM document_access_users ORDER BY keycloak_user_id")
        policies = {
            int(row["id"]): {"document_id": int(row["id"]), "title": str(row["title"]), "groups": [], "users": []}
            for row in documents
        }
        for row in groups:
            if int(row["document_id"]) in policies:
                policies[int(row["document_id"])]["groups"].append(str(row["group_path"]))
        for row in users:
            if int(row["document_id"]) in policies:
                policies[int(row["document_id"])]["users"].append(str(row["keycloak_user_id"]))
        return list(policies.values())

    async def replace_policy(self, document_id: int, actor_id: str, groups: list[str], users: list[str]) -> None:
        # All grants and the audit event commit atomically.
        async with self.pool.connection() as conn:
            async with conn.transaction():
                exists = await conn.fetchval("SELECT 1 FROM documents WHERE id=$1 FOR UPDATE", document_id)
                if not exists:
                    raise HTTPException(status_code=404, detail="Document not found")
                previous_groups = await conn.fetch(
                    "SELECT group_path FROM document_access_groups WHERE document_id=$1", document_id
                )
                previous_users = await conn.fetch(
                    "SELECT keycloak_user_id FROM document_access_users WHERE document_id=$1", document_id
                )
                old_policy = {
                    "groups": sorted(row["group_path"] for row in previous_groups),
                    "users": sorted(row["keycloak_user_id"] for row in previous_users),
                }
                await conn.execute("DELETE FROM document_access_groups WHERE document_id=$1", document_id)
                await conn.execute("DELETE FROM document_access_users WHERE document_id=$1", document_id)
                if groups:
                    await conn.executemany(
                        "INSERT INTO document_access_groups (document_id, group_path) VALUES ($1,$2)",
                        [(document_id, group) for group in groups],
                    )
                if users:
                    await conn.executemany(
                        "INSERT INTO document_access_users (document_id, keycloak_user_id) VALUES ($1,$2)",
                        [(document_id, subject) for subject in users],
                    )
                await conn.execute(
                    """INSERT INTO document_access_audit
                    (document_id, actor_id, action, old_policy, new_policy)
                    VALUES ($1,$2,'replace',$3::jsonb,$4::jsonb)""",
                    document_id, actor_id,
                    json.dumps(old_policy),
                    json.dumps({"groups": groups, "users": users}),
                )
