from __future__ import annotations

from typing import Any

import httpx


class ElasticsearchError(RuntimeError):
    pass


class ElasticsearchClient:
    def __init__(
        self,
        base_url: str,
        *,
        username: str | None = None,
        password: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        auth = (username, password or "") if username else None
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            auth=auth,
            timeout=timeout,
            headers={"Accept": "application/json"},
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        json: object | None = None,
        params: dict[str, object] | None = None,
        content: bytes | str | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        response = await self._client.request(
            method,
            path,
            json=json,
            params=params,
            content=content,
            headers=headers,
        )
        if response.status_code >= 400:
            body = response.text[:2000]
            raise ElasticsearchError(
                f"Elasticsearch {method} {path} failed: HTTP {response.status_code}: {body}"
            )
        if not response.content:
            return None
        content_type = response.headers.get("content-type", "")
        if "json" in content_type:
            return response.json()
        return response.text

    async def info(self) -> dict[str, Any]:
        result = await self.request("GET", "/")
        if not isinstance(result, dict):
            raise ElasticsearchError("Unexpected Elasticsearch info response")
        return result

    async def plugins(self) -> list[dict[str, Any]]:
        result = await self.request("GET", "/_cat/plugins", params={"format": "json"})
        if not isinstance(result, list):
            raise ElasticsearchError("Unexpected Elasticsearch plugins response")
        return result

    async def index_exists(self, index: str) -> bool:
        response = await self._client.head(f"/{index}")
        if response.status_code == 404:
            return False
        if response.status_code >= 400:
            raise ElasticsearchError(
                f"Elasticsearch HEAD /{index} failed: HTTP {response.status_code}"
            )
        return True
