from __future__ import annotations

import json

from app.domain.models.search import SearchChunk
from app.infrastructure.elasticsearch.client import ElasticsearchClient, ElasticsearchError


class ElasticsearchDocumentIndex:
    def __init__(
        self,
        client: ElasticsearchClient,
        *,
        index_name: str,
    ) -> None:
        self._client = client
        self._index_name = index_name

    async def bulk_index(
        self,
        chunks: list[SearchChunk],
        vectors: list[list[float]],
    ) -> int:
        if len(chunks) != len(vectors):
            raise ValueError("chunks and vectors must have the same length")
        if not chunks:
            return 0

        lines: list[str] = []
        for chunk, vector in zip(chunks, vectors, strict=True):
            lines.append(
                json.dumps(
                    {
                        "index": {
                            "_index": self._index_name,
                            "_id": chunk.id,
                        }
                    },
                    ensure_ascii=False,
                )
            )
            lines.append(
                json.dumps(
                    chunk.to_index_document(vector=vector),
                    ensure_ascii=False,
                )
            )
        payload = "\n".join(lines) + "\n"
        result = await self._client.request(
            "POST",
            "/_bulk",
            params={"refresh": "wait_for"},
            content=payload,
            headers={"Content-Type": "application/x-ndjson"},
        )
        if not isinstance(result, dict):
            raise ElasticsearchError("Unexpected bulk indexing response")
        if result.get("errors"):
            failed: list[str] = []
            for item in result.get("items", []):
                operation = item.get("index", {}) if isinstance(item, dict) else {}
                error = operation.get("error") if isinstance(operation, dict) else None
                if error:
                    failed.append(str(error))
                    if len(failed) >= 3:
                        break
            raise ElasticsearchError(
                "Bulk indexing reported errors: " + "; ".join(failed)
            )
        return len(chunks)

    async def count_document(self, document_id: int) -> int:
        result = await self._client.request(
            "POST",
            f"/{self._index_name}/_count",
            json={"query": {"term": {"document_id": document_id}}},
        )
        if not isinstance(result, dict) or "count" not in result:
            raise ElasticsearchError("Unexpected count response")
        return int(result["count"])
