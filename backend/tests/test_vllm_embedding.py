from __future__ import annotations

import httpx
import pytest

from app.infrastructure.embedding.vllm import EmbeddingError, VLLMEmbeddingProvider


@pytest.mark.asyncio
async def test_vllm_embedding_provider_matches_existing_contract() -> None:
    seen: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["authorization"] = request.headers.get("Authorization")
        seen["payload"] = __import__("json").loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "data": [
                    {"embedding": [0.1, 0.2, 0.3]},
                    {"embedding": [0.4, 0.5, 0.6]},
                ]
            },
        )

    provider = VLLMEmbeddingProvider(
        "http://embedding.local:4070",
        model="bge-m3",
        api_key="test-key",
        transport=httpx.MockTransport(handler),
    )
    try:
        vectors = await provider.embed(["first", "second"])
    finally:
        await provider.close()

    assert seen["path"] == "/v1/embeddings"
    assert seen["authorization"] == "Bearer test-key"
    assert seen["payload"] == {"model": "bge-m3", "input": ["first", "second"]}
    assert vectors == [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]


@pytest.mark.asyncio
async def test_vllm_embedding_provider_retries_server_error(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(503, json={"error": "busy"})
        return httpx.Response(200, json={"data": [{"embedding": [1.0, 2.0]}]})

    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("app.infrastructure.embedding.vllm.asyncio.sleep", no_sleep)
    provider = VLLMEmbeddingProvider(
        "http://embedding.local:4070",
        model="bge-m3",
        max_retries=2,
        transport=httpx.MockTransport(handler),
    )
    try:
        vector = await provider.embed_query("hello")
    finally:
        await provider.close()

    assert vector == [1.0, 2.0]
    assert attempts == 2


@pytest.mark.asyncio
async def test_vllm_embedding_provider_rejects_malformed_response() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": []})

    provider = VLLMEmbeddingProvider(
        "http://embedding.local:4070",
        model="bge-m3",
        max_retries=1,
        transport=httpx.MockTransport(handler),
    )
    try:
        with pytest.raises(EmbeddingError):
            await provider.embed_query("hello")
    finally:
        await provider.close()
