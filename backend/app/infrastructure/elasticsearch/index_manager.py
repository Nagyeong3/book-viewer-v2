from __future__ import annotations

from dataclasses import dataclass

from app.infrastructure.elasticsearch.client import ElasticsearchClient, ElasticsearchError


@dataclass(frozen=True, slots=True)
class IndexNames:
    alias: str
    version: int

    @property
    def physical(self) -> str:
        return f"{self.alias}-v{self.version}"


def build_document_index_definition(*, vector_dimensions: int) -> dict[str, object]:
    return {
        "settings": {
            "analysis": {
                "analyzer": {
                    "my_korean_analyzer": {
                        "type": "custom",
                        "tokenizer": "nori_tokenizer",
                        "filter": ["lowercase", "nori_readingform"],
                    }
                }
            }
        },
        "mappings": {
            "dynamic": "strict",
            "properties": {
                "document_id": {"type": "keyword"},
                "document_name": {
                    "type": "text",
                    "analyzer": "my_korean_analyzer",
                    "fields": {"raw": {"type": "keyword"}},
                },
                "content_id": {"type": "keyword"},
                "parent_id": {"type": "keyword"},
                "order_index": {"type": "integer"},
                "level": {"type": "integer"},
                "page": {"type": "integer"},
                "content_type": {"type": "keyword"},
                "text": {"type": "text", "analyzer": "my_korean_analyzer"},
                "title_path": {"type": "text", "analyzer": "my_korean_analyzer"},
                "doc_image_path": {"type": "keyword", "index": False},
                "cropped_image_path": {"type": "keyword", "index": False},
                "x_min": {"type": "integer"},
                "y_min": {"type": "integer"},
                "x_max": {"type": "integer"},
                "y_max": {"type": "integer"},
                "vector": {
                    "type": "dense_vector",
                    "dims": vector_dimensions,
                    "index": True,
                    "similarity": "cosine",
                    "index_options": {"type": "bbq_hnsw"},
                },
            },
        },
    }


class DocumentIndexManager:
    def __init__(
        self,
        client: ElasticsearchClient,
        *,
        alias: str,
        vector_dimensions: int,
    ) -> None:
        self._client = client
        self._alias = alias
        self._vector_dimensions = vector_dimensions

    async def ensure_physical_index(self, version: int) -> IndexNames:
        names = IndexNames(alias=self._alias, version=version)
        if not await self._client.index_exists(names.physical):
            await self._client.request(
                "PUT",
                f"/{names.physical}",
                json=build_document_index_definition(
                    vector_dimensions=self._vector_dimensions
                ),
            )
        return names

    async def alias_targets(self) -> tuple[str, ...]:
        try:
            result = await self._client.request("GET", f"/_alias/{self._alias}")
        except ElasticsearchError as exc:
            if "HTTP 404" in str(exc):
                return ()
            raise
        if not isinstance(result, dict):
            raise ElasticsearchError("Unexpected alias response")
        return tuple(sorted(result.keys()))

    async def activate(self, version: int) -> IndexNames:
        names = await self.ensure_physical_index(version)
        targets = await self.alias_targets()
        actions: list[dict[str, object]] = [
            {"remove": {"index": target, "alias": self._alias}} for target in targets
        ]
        actions.append({"add": {"index": names.physical, "alias": self._alias}})
        await self._client.request("POST", "/_aliases", json={"actions": actions})
        return names
