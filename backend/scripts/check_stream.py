from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings
from app.infrastructure.llm.litellm import LiteLLMProvider


async def main() -> int:
    settings = get_settings()
    if not settings.litellm_base_url or not settings.litellm_api_key:
        print("ERROR: LiteLLM configuration is required")
        return 2

    llm = LiteLLMProvider(
        settings.litellm_base_url,
        model=settings.llm_model,
        api_key=settings.litellm_api_key,
        timeout=settings.llm_timeout,
        max_retries=settings.llm_max_retries,
        temperature=settings.llm_temperature,
        max_tokens=min(settings.llm_max_tokens, 256),
        retry_backoff_factor=settings.llm_retry_backoff_factor,
    )
    try:
        pieces: list[str] = []
        async for token in llm.stream(
            system_prompt="짧고 정확하게 답하세요.",
            user_prompt="스트리밍 연결 확인입니다. '스트리밍 정상'이라고 답하세요.",
        ):
            pieces.append(token)
            print(token, end="", flush=True)
        print()
        answer = "".join(pieces).strip()
        if not answer:
            print("ERROR: stream returned no content")
            return 3
        print(f"stream=ok model={settings.llm_model} chars={len(answer)}")
        return 0
    finally:
        await llm.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
