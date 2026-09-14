import pytest

from app.infrastructure.elasticsearch.index_manager import (
    DocumentIndexManager,
    build_document_index_definition,
)


class FakeClient:
    def __init__(self, exists=False, alias_result=None):
        self.exists = exists
        self.alias_result = alias_result or {}
        self.calls = []

    async def index_exists(self, index):
        self.calls.append(("HEAD", index))
        return self.exists

    async def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if path.startswith("/_alias/"):
            return self.alias_result
        return {"acknowledged": True}


def test_mapping_uses_nori_and_1024_dense_vector():
    definition = build_document_index_definition(vector_dimensions=1024)
    analyzer = definition["settings"]["analysis"]["analyzer"]["my_korean_analyzer"]
    vector = definition["mappings"]["properties"]["vector"]

    assert analyzer["tokenizer"] == "nori_tokenizer"
    assert "nori_readingform" in analyzer["filter"]
    assert vector["dims"] == 1024
    assert vector["similarity"] == "cosine"
    assert vector["index_options"]["type"] == "bbq_hnsw"


@pytest.mark.asyncio
async def test_prepare_index_does_not_change_alias():
    client = FakeClient(exists=False)
    manager = DocumentIndexManager(client, alias="rag-documents", vector_dimensions=1024)

    names = await manager.ensure_physical_index(1)

    assert names.physical == "rag-documents-v1"
    assert any(call[0:2] == ("PUT", "/rag-documents-v1") for call in client.calls)
    assert not any(call[0:2] == ("POST", "/_aliases") for call in client.calls)


@pytest.mark.asyncio
async def test_activate_swaps_only_v2_alias_targets():
    client = FakeClient(
        exists=True,
        alias_result={"rag-documents-v0": {"aliases": {"rag-documents": {}}}},
    )
    manager = DocumentIndexManager(client, alias="rag-documents", vector_dimensions=1024)

    await manager.activate(1)

    alias_call = next(call for call in client.calls if call[0:2] == ("POST", "/_aliases"))
    actions = alias_call[2]["json"]["actions"]
    assert actions == [
        {"remove": {"index": "rag-documents-v0", "alias": "rag-documents"}},
        {"add": {"index": "rag-documents-v1", "alias": "rag-documents"}},
    ]
