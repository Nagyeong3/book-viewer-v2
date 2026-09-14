from __future__ import annotations

import asyncio
from typing import Any

import httpx


class EmbeddingError(RuntimeError):
    pass


class VLLMEmbeddingProvider:
    def __init__(
        self,
        base_url: str,
        *,
        model: str,
        api_key: str = "EMPTY",
        timeout: float = 60.0,
        max_retries: int = 3,
        retry_backoff_factor: float = 1.5,
    ) -> None:
        if max_retries < 1:
            raise ValueError("max_retries must be >= 1")
        self._model = model
        self._api_key = api_key
        self._max_retries = max_retries
        self._retry_backoff_factor = retry_backoff_factor
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=timeout,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def _request_embeddings(self, texts: list[str]) -> dict[str, Any]:
        payload = {"model": self._model, "input": texts}
        last_error: Exception | None = None

        for attempt in range(self._max_retries):
            try:
                response = await self._client.post("/v1/embeddings", json=payload)
                response.raise_for_status()
                result = response.json()
                if not isinstance(result, dict):
                    raise EmbeddingError("Unexpected embedding response type")
                return result
            except (httpx.HTTPError, ValueError, EmbeddingError) as exc:
                last_error = exc
                if attempt == self._max_retries - 1:
                    break
                await asyncio.sleep(self._retry_backoff_factor * (2**attempt))

        raise EmbeddingError(f"VLLM embedding request failed after retries: {last_error}")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        result = await self._request_embeddings(texts)
        data = result.get("data")
        if not isinstance(data, list):
            raise EmbeddingError("Embedding response does not contain a data list")

        vectors: list[list[float]] = []
        for item in data:
            if not isinstance(item, dict) or not isinstance(item.get("embedding"), list):
                raise EmbeddingError("Embedding response item is malformed")
            vectors.append([float(value) for value in item["embedding"]])
        return vectors

    async def embed_query(self, text: str) -> list[float]:
        vectors = await self.embed([text])
        if len(vectors) != 1:
            raise EmbeddingError("Expected exactly one query embedding")
        return vectors[0]
