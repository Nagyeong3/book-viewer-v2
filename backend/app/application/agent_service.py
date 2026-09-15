from __future__ import annotations

import json
from collections.abc import AsyncIterator

from app.application.context_builder import BuiltContext, ContextBuilder
from app.application.rag_service import SYSTEM_PROMPT
from app.application.retrieval_service import RetrievalService
from app.domain.models.rag import AgentAnswer, AgentPlan, AgentToolName
from app.domain.ports.retrieval import LLMProvider


PLANNER_SYSTEM_PROMPT = """당신은 항공 기술문서 검색 도구 선택기다.
아래 네 도구 중 정확히 하나만 선택한다.
- full_text_search: 정확한 용어, 규정 문구, 번호, 특정 표현 검색
- vector_search: 의미가 비슷한 설명이나 자연어 질문 검색
- hybrid_search: 일반적인 질의응답에서 키워드와 의미 검색을 함께 사용
- title_search: 장/절/항 제목이나 목차 성격의 질의

반드시 JSON 객체 하나만 출력한다.
스키마: {"tool":"hybrid_search","query":"검색어","top_k":8,"rationale":"짧은 이유"}
사용자가 지정한 문서 범위는 변경할 수 없으며 Elasticsearch DSL이나 임의 도구 이름을 만들면 안 된다.
"""


class AgentPlanner:
    _allowed_tools: set[str] = {
        "full_text_search",
        "vector_search",
        "hybrid_search",
        "title_search",
    }

    def __init__(self, llm_provider: LLMProvider, *, default_top_k: int = 8) -> None:
        self._llm_provider = llm_provider
        self._default_top_k = default_top_k

    async def plan(self, question: str, *, requested_top_k: int | None = None) -> AgentPlan:
        raw = await self._llm_provider.invoke(
            system_prompt=PLANNER_SYSTEM_PROMPT,
            user_prompt=f"사용자 질문:\n{question.strip()}",
        )
        fallback_top_k = requested_top_k or self._default_top_k
        try:
            start = raw.find("{")
            end = raw.rfind("}")
            if start < 0 or end < start:
                raise ValueError("planner did not return a JSON object")
            data = json.loads(raw[start : end + 1])
            if not isinstance(data, dict):
                raise ValueError("planner JSON is not an object")
            tool = str(data.get("tool", ""))
            if tool not in self._allowed_tools:
                raise ValueError("planner selected an unsupported tool")
            query = str(data.get("query") or question).strip()
            if not query:
                query = question.strip()
            top_k_raw = data.get("top_k", fallback_top_k)
            top_k = max(1, min(int(top_k_raw), 50))
            if requested_top_k is not None:
                top_k = min(top_k, requested_top_k)
            rationale = str(data.get("rationale") or "").strip()
            return AgentPlan(
                tool=tool,  # type: ignore[arg-type]
                query=query,
                top_k=top_k,
                rationale=rationale,
            )
        except (ValueError, TypeError, json.JSONDecodeError):
            return AgentPlan(
                tool="hybrid_search",
                query=question.strip(),
                top_k=fallback_top_k,
                rationale="planner 응답을 해석하지 못해 안전한 hybrid_search로 대체",
            )


class AgentService:
    def __init__(
        self,
        retrieval_service: RetrievalService,
        llm_provider: LLMProvider,
        context_builder: ContextBuilder,
        *,
        default_top_k: int = 8,
    ) -> None:
        self._retrieval_service = retrieval_service
        self._llm_provider = llm_provider
        self._context_builder = context_builder
        self._planner = AgentPlanner(llm_provider, default_top_k=default_top_k)

    async def _retrieve(
        self,
        plan: AgentPlan,
        document_ids: list[int],
    ) -> BuiltContext:
        if plan.tool == "full_text_search":
            hits = await self._retrieval_service.search(
                plan.query, document_ids, mode="keyword", top_k=plan.top_k
            )
        elif plan.tool == "vector_search":
            hits = await self._retrieval_service.search(
                plan.query, document_ids, mode="vector", top_k=plan.top_k
            )
        elif plan.tool == "title_search":
            hits = await self._retrieval_service.title_search(
                plan.query, document_ids, top_k=plan.top_k
            )
        else:
            hits = await self._retrieval_service.search(
                plan.query, document_ids, mode="hybrid", top_k=plan.top_k
            )
        return self._context_builder.build(hits)

    @staticmethod
    def _answer_prompt(question: str, plan: AgentPlan, built: BuiltContext) -> str:
        return (
            f"질문:\n{question.strip()}\n\n"
            f"선택한 검색 도구: {plan.tool}\n"
            f"검색어: {plan.query}\n\n"
            f"검색 문맥:\n{built.text}\n\n"
            "위 문맥만 근거로 한국어로 답변하세요."
        )

    async def answer(
        self,
        question: str,
        document_ids: list[int],
        *,
        top_k: int | None = None,
    ) -> AgentAnswer:
        if not document_ids:
            raise ValueError("document_ids must not be empty")
        plan = await self._planner.plan(question, requested_top_k=top_k)
        built = await self._retrieve(plan, document_ids)
        if not built.sources:
            return AgentAnswer(
                answer="선택한 문서 범위에서 질문과 관련된 근거를 찾지 못했습니다.",
                plan=plan,
                sources=(),
            )
        answer = await self._llm_provider.invoke(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=self._answer_prompt(question, plan, built),
        )
        return AgentAnswer(answer=answer, plan=plan, sources=built.sources)

    async def stream_answer(
        self,
        question: str,
        document_ids: list[int],
        *,
        top_k: int | None = None,
    ) -> AsyncIterator[tuple[str, object]]:
        if not document_ids:
            raise ValueError("document_ids must not be empty")
        plan = await self._planner.plan(question, requested_top_k=top_k)
        yield "plan", plan
        built = await self._retrieve(plan, document_ids)
        yield "sources", built.sources
        if not built.sources:
            yield "token", "선택한 문서 범위에서 질문과 관련된 근거를 찾지 못했습니다."
            yield "done", {"tool": plan.tool}
            return
        async for token in self._llm_provider.stream(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=self._answer_prompt(question, plan, built),
        ):
            yield "token", token
        yield "done", {"tool": plan.tool}
