import json

import httpx
import pytest

from app.infrastructure.llm.litellm import LiteLLMProvider


@pytest.mark.asyncio
async def test_litellm_provider_preserves_v1_base_path_and_payload():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["payload"] = json.loads(request.content.decode())
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "정상 응답"}}]},
        )

    provider = LiteLLMProvider(
        "http://litellm.local:4070/v1",
        model="gpt-oss-120b-vllm",
        api_key="secret",
        max_retries=1,
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await provider.invoke(system_prompt="system", user_prompt="question")
    finally:
        await provider.close()

    assert result == "정상 응답"
    assert captured["url"] == "http://litellm.local:4070/v1/chat/completions"
    assert captured["payload"]["model"] == "gpt-oss-120b-vllm"
    assert captured["payload"]["temperature"] == 0.0
    assert captured["payload"]["max_tokens"] == 8192
    assert captured["payload"]["messages"][1] == {"role": "user", "content": "question"}
    assert captured["headers"]["authorization"] == "Bearer secret"
