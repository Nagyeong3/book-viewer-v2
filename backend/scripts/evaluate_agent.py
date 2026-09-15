from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.application.agent_service import AgentService
from app.application.context_builder import ContextBuilder
from app.application.retrieval_service import RetrievalService
from app.core.config import get_settings
from app.infrastructure.elasticsearch.client import ElasticsearchClient
from app.infrastructure.elasticsearch.retrieval_repository import ElasticsearchRetrievalRepository
from app.infrastructure.embedding.vllm import VLLMEmbeddingProvider
from app.infrastructure.llm.litellm import LiteLLMProvider


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate agent tool choice, retrieval hit rate, and scope safety")
    parser.add_argument("dataset", type=Path, help="JSONL dataset")
    parser.add_argument("--top-k", type=int, default=5)
    return parser.parse_args()


def load_dataset(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        item = json.loads(line)
        if not isinstance(item, dict) or not item.get("question") or not item.get("document_ids"):
            raise ValueError(f"Invalid dataset row {number}")
        rows.append(item)
    return rows


async def main() -> int:
    args = parse_args()
    rows = load_dataset(args.dataset)
    if not rows:
        print("ERROR: dataset is empty")
        return 2

    settings = get_settings()
    required = [settings.elasticsearch_url, settings.embedding_base_url, settings.litellm_base_url, settings.litellm_api_key]
    if not all(required):
        print("ERROR: Elasticsearch, embedding, and LiteLLM configuration are required")
        return 2

    es = ElasticsearchClient(settings.elasticsearch_url, username=settings.elasticsearch_username, password=settings.elasticsearch_password, timeout=settings.elasticsearch_timeout)
    embedding = VLLMEmbeddingProvider(settings.embedding_base_url, model=settings.embedding_model, api_key=settings.embedding_api_key or "EMPTY", timeout=settings.embedding_timeout, max_retries=settings.embedding_max_retries, retry_backoff_factor=settings.embedding_retry_backoff_factor)
    llm = LiteLLMProvider(settings.litellm_base_url, model=settings.llm_model, api_key=settings.litellm_api_key, timeout=settings.llm_timeout, max_retries=settings.llm_max_retries, temperature=settings.llm_temperature, max_tokens=settings.llm_max_tokens, retry_backoff_factor=settings.llm_retry_backoff_factor)

    try:
        retrieval = RetrievalService(
            ElasticsearchRetrievalRepository(es, index_name=settings.es_document_alias),
            embedding,
            title_boost=settings.retrieval_title_boost,
            keyword_weight=settings.retrieval_keyword_weight,
            vector_weight=settings.retrieval_vector_weight,
            candidate_multiplier=settings.retrieval_candidate_multiplier,
        )
        agent = AgentService(retrieval, llm, ContextBuilder(max_chars=settings.rag_context_max_chars), default_top_k=settings.rag_top_k)

        scope_violations = 0
        hit_count = 0
        tool_correct = 0
        tool_expected = 0

        for index, row in enumerate(rows, start=1):
            question = str(row["question"])
            document_ids = [int(value) for value in row["document_ids"]]  # type: ignore[arg-type]
            result = await agent.answer(question, document_ids, top_k=args.top_k)
            returned_content_ids = {source.content_id for source in result.sources}
            returned_document_ids = {source.document_id for source in result.sources}
            if not returned_document_ids.issubset(set(document_ids)):
                scope_violations += 1

            expected_content_ids = {int(value) for value in row.get("expected_content_ids", [])}  # type: ignore[arg-type]
            hit = bool(expected_content_ids & returned_content_ids) if expected_content_ids else True
            hit_count += int(hit)

            expected_tool = row.get("expected_tool")
            if expected_tool:
                tool_expected += 1
                tool_correct += int(result.plan.tool == expected_tool)

            print(
                f"case={index} tool={result.plan.tool} hit={str(hit).lower()} "
                f"scope_ok={str(returned_document_ids.issubset(set(document_ids))).lower()} sources={len(result.sources)}"
            )

        total = len(rows)
        print(f"cases={total}")
        print(f"hit_at_{args.top_k}={hit_count / total:.4f}")
        print(f"scope_violations={scope_violations}")
        if tool_expected:
            print(f"tool_accuracy={tool_correct / tool_expected:.4f} ({tool_correct}/{tool_expected})")
        return 1 if scope_violations else 0
    finally:
        await llm.close()
        await embedding.close()
        await es.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
