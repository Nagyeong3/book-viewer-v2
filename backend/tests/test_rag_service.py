import pytest

from app.application.context_builder import ContextBuilder
from app.application.rag_service import RagService
from app.domain.models.rag import RetrievedChunk


class Retrieval:
    async def search(self, query, document_ids, *, mode, top_k):
        return [
            RetrievedChunk(
                chunk_id="21:10",
                document_id=21,
                document_name="LAH PDF 교범",
                content_id=10,
                text="유압 계통 점검 절차 본문",
                title_path=("제1장", "유압 계통"),
                page=12,
                content_type="text",
                score=0.9,
            )
        ]


class LLM:
    def __init__(self):
        self.calls = []

    async def invoke(self, *, system_prompt, user_prompt):
        self.calls.append((system_prompt, user_prompt))
        return "점검 절차는 문맥에 따릅니다. [S1]"


@pytest.mark.asyncio
async def test_rag_service_builds_source_labeled_context():
    llm = LLM()
    service = RagService(Retrieval(), llm, ContextBuilder(max_chars=4000), default_top_k=5)

    result = await service.answer("유압 점검 절차는?", [21], mode="hybrid")

    assert result.answer.endswith("[S1]")
    assert result.sources[0].source_id == "S1"
    assert result.sources[0].document_id == 21
    assert "[S1]" in llm.calls[0][1]
    assert "유압 계통 점검 절차 본문" in llm.calls[0][1]


@pytest.mark.asyncio
async def test_rag_service_skips_llm_when_no_sources():
    class EmptyRetrieval:
        async def search(self, *args, **kwargs):
            return []

    llm = LLM()
    service = RagService(EmptyRetrieval(), llm, ContextBuilder(max_chars=4000))
    result = await service.answer("없는 질문", [21])

    assert "근거를 찾지 못했습니다" in result.answer
    assert result.sources == ()
    assert llm.calls == []
