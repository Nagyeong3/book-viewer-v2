import pytest

from app.application.agent_service import AgentService
from app.application.context_builder import ContextBuilder
from app.domain.models.rag import RetrievedChunk


class FakeLLM:
    def __init__(self, planner_response):
        self.planner_response = planner_response
        self.invocations = []

    async def invoke(self, *, system_prompt, user_prompt):
        self.invocations.append((system_prompt, user_prompt))
        if len(self.invocations) == 1:
            return self.planner_response
        return "근거 기반 답변 [S1]"

    async def stream(self, *, system_prompt, user_prompt):
        yield "근거 기반 "
        yield "답변 [S1]"


class FakeRetrieval:
    def __init__(self):
        self.calls = []

    async def search(self, query, document_ids, *, mode="hybrid", top_k=8):
        self.calls.append(("search", query, list(document_ids), mode, top_k))
        return [
            RetrievedChunk(
                chunk_id="21:1",
                document_id=21,
                document_name="Manual",
                content_id=1,
                text="본문",
                title_path=("제1장",),
                page=1,
                content_type="text",
                score=1.0,
            )
        ]

    async def title_search(self, query, document_ids, *, top_k=8):
        self.calls.append(("title", query, list(document_ids), top_k))
        return await self.search(query, document_ids, mode="keyword", top_k=top_k)


@pytest.mark.asyncio
async def test_agent_uses_only_allowed_tool_and_preserves_document_scope():
    llm = FakeLLM(
        '{"tool":"full_text_search","query":"적용 범위","top_k":5,"rationale":"정확한 용어"}'
    )
    retrieval = FakeRetrieval()
    service = AgentService(
        retrieval,
        llm,
        ContextBuilder(max_chars=4000),
        default_top_k=8,
    )

    result = await service.answer("적용 범위가 뭐야?", [21, 104], top_k=5)

    assert result.plan.tool == "full_text_search"
    assert retrieval.calls[0] == ("search", "적용 범위", [21, 104], "keyword", 5)
    assert result.answer.endswith("[S1]")
    assert result.sources[0].document_id == 21


@pytest.mark.asyncio
async def test_agent_falls_back_to_hybrid_when_planner_output_is_invalid():
    llm = FakeLLM("not-json")
    retrieval = FakeRetrieval()
    service = AgentService(
        retrieval,
        llm,
        ContextBuilder(max_chars=4000),
        default_top_k=7,
    )

    result = await service.answer("설명해줘", [21])

    assert result.plan.tool == "hybrid_search"
    assert retrieval.calls[0][3] == "hybrid"
    assert retrieval.calls[0][2] == [21]


@pytest.mark.asyncio
async def test_agent_stream_emits_plan_sources_tokens_and_done():
    llm = FakeLLM(
        '{"tool":"hybrid_search","query":"질문","top_k":3,"rationale":"일반 질의"}'
    )
    service = AgentService(
        FakeRetrieval(),
        llm,
        ContextBuilder(max_chars=4000),
        default_top_k=8,
    )

    events = [event async for event in service.stream_answer("질문", [21], top_k=3)]

    assert [event for event, _ in events] == ["plan", "sources", "token", "token", "done"]
