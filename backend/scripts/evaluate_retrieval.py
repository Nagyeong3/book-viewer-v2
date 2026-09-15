from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.application.retrieval_service import RetrievalService
from app.core.config import get_settings
from app.infrastructure.elasticsearch.client import ElasticsearchClient
from app.infrastructure.elasticsearch.retrieval_repository import ElasticsearchRetrievalRepository
from app.infrastructure.embedding.vllm import VLLMEmbeddingProvider


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate retrieval Hit@K and MRR from JSONL")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--mode", choices=["keyword", "vector", "hybrid"], default="hybrid")
    parser.add_argument("--top-k", type=int, default=5)
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    settings = get_settings()
    rows = [
        json.loads(line)
        for line in Path(args.dataset).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not rows:
        print("ERROR: evaluation dataset is empty")
        return 2

    es = ElasticsearchClient(
        settings.elasticsearch_url or "",
        username=settings.elasticsearch_username,
        password=settings.elasticsearch_password,
        timeout=settings.elasticsearch_timeout,
    )
    embedding = VLLMEmbeddingProvider(
        settings.embedding_base_url or "",
        model=settings.embedding_model,
        api_key=settings.embedding_api_key or "EMPTY",
        timeout=settings.embedding_timeout,
        max_retries=settings.embedding_max_retries,
        retry_backoff_factor=settings.embedding_retry_backoff_factor,
    )
    try:
        service = RetrievalService(
            ElasticsearchRetrievalRepository(es, index_name=settings.es_document_alias),
            embedding,
            title_boost=settings.retrieval_title_boost,
            keyword_weight=settings.retrieval_keyword_weight,
            vector_weight=settings.retrieval_vector_weight,
            candidate_multiplier=settings.retrieval_candidate_multiplier,
        )
        hits = 0
        reciprocal_rank = 0.0
        for position, row in enumerate(rows, start=1):
            relevant = {int(value) for value in row["relevant_content_ids"]}
            results = await service.search(
                str(row["query"]),
                [int(value) for value in row["document_ids"]],
                mode=args.mode,
                top_k=args.top_k,
            )
            rank = next(
                (rank for rank, result in enumerate(results, start=1) if result.content_id in relevant),
                None,
            )
            if rank is not None:
                hits += 1
                reciprocal_rank += 1.0 / rank
            print(f"case={position}/{len(rows)} hit={rank is not None} rank={rank}")

        total = len(rows)
        print(
            f"evaluation=ok mode={args.mode} cases={total} top_k={args.top_k} "
            f"hit_at_k={hits / total:.4f} mrr={reciprocal_rank / total:.4f}"
        )
        return 0
    finally:
        await embedding.close()
        await es.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
