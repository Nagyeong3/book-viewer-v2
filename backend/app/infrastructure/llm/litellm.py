from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx


class LLMError(RuntimeError):
    pass


class LiteLLMProvider:
    def __init__(
        self,
        base_url: str,
        *,
        model: str,
        api_key: str,
        timeout: float = 120.0,
        max_retries: int = 2,
        temperature: float = 0.0,
        max_tokens: int = 8192,
        retry_backoff_factor: float = 1.5,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if max_retries < 1:
            raise ValueError("max_retries must be >= 1")
        self._model = model
        self._max_retries = max_retries
        self._temperature = temperature
        self._max_tokens = max_tokens
        self._retry_backoff_factor = retry_backoff_factor
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + "/",
            timeout=timeout,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            transport=transport,
        )

    async def close(self) -> None:
        await self._client.aclose()

    def _payload(self, system_prompt: str, user_prompt: str, *, stream: bool) -> dict[str, object]:
        payload: dict[str, object] = {
            "model": self._model,
            "temperature": self._temperature,
            "max_tokens": self._max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if stream:
            payload["stream"] = True
        return payload

    @staticmethod
    async def _raise_for_status(response: httpx.Response) -> None:
        if 400 <= response.status_code < 500:
            body = (await response.aread()).decode(errors="replace")[:4000]
            raise LLMError(
                f"LiteLLM rejected request: HTTP {response.status_code}: {body}"
            )
        response.raise_for_status()

    async def invoke(self, *, system_prompt: str, user_prompt: str) -> str:
        payload = self._payload(system_prompt, user_prompt, stream=False)
        last_error: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                response = await self._client.post("chat/completions", json=payload)
                await self._raise_for_status(response)
                data: Any = response.json()
                choices = data.get("choices") if isinstance(data, dict) else None
                if not isinstance(choices, list) or not choices:
                    raise LLMError("LiteLLM response does not contain choices")
                message = choices[0].get("message") if isinstance(choices[0], dict) else None
                content = message.get("content") if isinstance(message, dict) else None
                if not isinstance(content, str) or not content.strip():
                    raise LLMError("LiteLLM response does not contain message content")
                return content.strip()
            except LLMError as exc:
                last_error = exc
                if "rejected request: HTTP 4" in str(exc):
                    break
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
            if attempt < self._max_retries - 1:
                await asyncio.sleep(self._retry_backoff_factor * (2**attempt))
        raise LLMError(f"LiteLLM request failed after retries: {last_error}")

    async def stream(self, *, system_prompt: str, user_prompt: str) -> AsyncIterator[str]:
        payload = self._payload(system_prompt, user_prompt, stream=True)
        async with self._client.stream("POST", "chat/completions", json=payload) as response:
            await self._raise_for_status(response)
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    item: Any = json.loads(data)
                except ValueError as exc:
                    raise LLMError(f"Malformed LiteLLM stream event: {data[:500]}") from exc
                choices = item.get("choices") if isinstance(item, dict) else None
                if not isinstance(choices, list) or not choices:
                    continue
                delta = choices[0].get("delta") if isinstance(choices[0], dict) else None
                content = delta.get("content") if isinstance(delta, dict) else None
                if isinstance(content, str) and content:
                    yield content
