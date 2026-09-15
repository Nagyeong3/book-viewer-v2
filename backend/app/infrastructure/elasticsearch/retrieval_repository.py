from __future__ import annotations

from typing import Any

from app.domain.models.rag import RetrievedChunk
from app.infrastructure.elasticsearch.client import ElasticsearchClient, ElasticsearchError


class ElasticsearchRetrievalRepository:
    def __init__(self, client: ElasticsearchClient, *, index_name: str) -> None:
        self._client = client
        self._index_name = index_name

    async def keyword_search(
        self,
        query: str,
        document_ids: list[int],
        *,
        top_k: int,
        title_boost: float,
    ) -> list[RetrievedChunk]:
        self._validate_scope(document_ids)
        body = {
            "size": top_k,
            "query": {
                "bool": {
                    "filter": [{"terms": {"document_id": document_ids}}],
                    "must": [
                        {
                            "multi_match": {
                                "query": query,
                                "fields": [f"title_path^{title_boost}", "text"],
                                "type": "best_fields",
                                "operator": "or",
                            }
                        }
                    ],
                }
            },
            "_source": self._source_fields(),
        }
        result = await self._client.request("POST", f"/{self._index_name}/_search", json=body)
        return self._parse_hits(result, score_kind="keyword")

    async def vector_search(
        self,
        query_vector: list[float],
        document_ids: list[int],
        *,
        top_k: int,
        num_candidates: int,
    ) -> list[RetrievedChunk]:
        self._validate_scope(document_ids)
        body = {
            "knn": {
                "field": "vector",
                "query_vector": query_vector,
                "k": top_k,
                "num_candidates": max(num_candidates, top_k),
                "filter": {"terms": {"document_id": document_ids}},
            },
            "_source": self._source_fields(),
        }
        result = await self._client.request("POST", f"/{self._index_name}/_search", json=body)
        return self._parse_hits(result, score_kind="vector")

    @staticmethod
    def _validate_scope(document_ids: list[int]) -> None:
        if not document_ids:
            raise ValueError("document_ids must not be empty; retrieval scope may not be dropped")

    @staticmethod
    def _source_fields() -> list[str]:
        return [
            "document_id",
            "document_name",
            "content_id",
            "text",
            "title_path",
            "page",
            "content_type",
        ]

    @staticmethod
    def _parse_hits(result: Any, *, score_kind: str) -> list[RetrievedChunk]:
        if not isinstance(result, dict):
            raise ElasticsearchError("Unexpected Elasticsearch search response")
        hits_wrapper = result.get("hits")
        if not isinstance(hits_wrapper, dict) or not isinstance(hits_wrapper.get("hits"), list):
            raise ElasticsearchError("Elasticsearch search response does not contain hits")

        parsed: list[RetrievedChunk] = []
        for hit in hits_wrapper["hits"]:
            if not isinstance(hit, dict) or not isinstance(hit.get("_source"), dict):
                continue
            source = hit["_source"]
            raw_score = float(hit.get("_score") or 0.0)
            title_path = source.get("title_path") or []
            if isinstance(title_path, str):
                title_path = [title_path]
            parsed.append(
                RetrievedChunk(
                    chunk_id=str(hit.get("_id") or ""),
                    document_id=int(source["document_id"]),
                    document_name=str(source.get("document_name") or ""),
                    content_id=int(source["content_id"]),
                    text=str(source.get("text") or ""),
                    title_path=tuple(str(item) for item in title_path),
                    page=int(source["page"]) if source.get("page") is not None else None,
                    content_type=str(source["content_type"]) if source.get("content_type") is not None else None,
                    score=raw_score,
                    keyword_score=raw_score if score_kind == "keyword" else None,
                    vector_score=raw_score if score_kind == "vector" else None,
                )
            )
        return parsed
