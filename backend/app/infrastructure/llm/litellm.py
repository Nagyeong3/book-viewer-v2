from __future__ import annotations

import asyncio
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

    async def invoke(self, *, system_prompt: str, user_prompt: str) -> str:
        payload = {
            "model": self._model,
            "temperature": self._temperature,
            "max_tokens": self._max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        last_error: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                response = await self._client.post("chat/completions", json=payload)
                response.raise_for_status()
                data: Any = response.json()
                choices = data.get("choices") if isinstance(data, dict) else None
                if not isinstance(choices, list) or not choices:
                    raise LLMError("LiteLLM response does not contain choices")
                message = choices[0].get("message") if isinstance(choices[0], dict) else None
                content = message.get("content") if isinstance(message, dict) else None
                if not isinstance(content, str) or not content.strip():
                    raise LLMError("LiteLLM response does not contain message content")
                return content.strip()
            except (httpx.HTTPError, ValueError, LLMError) as exc:
                last_error = exc
                if attempt == self._max_retries - 1:
                    break
                await asyncio.sleep(self._retry_backoff_factor * (2**attempt))
        raise LLMError(f"LiteLLM request failed after retries: {last_error}")
