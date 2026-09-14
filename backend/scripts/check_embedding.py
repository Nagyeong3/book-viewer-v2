from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings
from app.infrastructure.embedding.vllm import VLLMEmbeddingProvider


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check the configured VLLM embedding endpoint")
    parser.add_argument("--text", default="유압 계통 정비 절차")
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    settings = get_settings()
    if not settings.embedding_base_url:
        print("ERROR: EMBEDDING_BASE_URL is not configured")
        return 2

    provider = VLLMEmbeddingProvider(
        settings.embedding_base_url,
        model=settings.embedding_model,
        api_key=settings.embedding_api_key or "EMPTY",
        timeout=settings.embedding_timeout,
        max_retries=settings.embedding_max_retries,
        retry_backoff_factor=settings.embedding_retry_backoff_factor,
    )
    try:
        vector = await provider.embed_query(args.text)
        print(
            f"embedding=ok model={settings.embedding_model} "
            f"dimensions={len(vector)} expected={settings.embedding_dimensions}"
        )
        if len(vector) != settings.embedding_dimensions:
            print("ERROR: embedding dimension mismatch")
            return 3
        return 0
    finally:
        await provider.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
