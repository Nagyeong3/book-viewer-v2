from __future__ import annotations

import json
from collections.abc import AsyncIterator

from app.application.context_builder import BuiltContext, ContextBuilder
from app.application.rag_service import SYSTEM_PROMPT
from app.application.retrieval_service import RetrievalService
from app.domain.models.rag import AgentAnswer, AgentPlan, AgentToolName, RetrievedChunk
from app.domain.ports.retrieval import LLMProvider


PLANNER_SYSTEM_PROMPT = """당신은 항공 기술문서 검색 에이전트의 Planner다.
사용자 질문을 분석해 아래 검색 도구 중 가장 적절한 하나를 선택한다.
- full_text_search: 정확한 용어, 규정 문구, 번호, 특정 표현 검색
- vector_search: 의미가 비슷한 설명이나 자연어 질문 검색
- hybrid_search: 일반적인 질의응답에서 키워드와 의미 검색을 함께 사용
- title_search: 장/절/항 제목이나 목차 성격의 질의

반드시 JSON 객체 하나만 출력한다.
스키마: {"tool":"hybrid_search","query":"검색어","top_k":8,"rationale":"짧은 이유"}
사용자가 지정한 document_ids 범위는 절대로 변경할 수 없다.
Elasticsearch DSL이나 허용되지 않은 도구 이름을 만들지 않는다.
"""


EVALUATOR_SYSTEM_PROMPT = """당신은 항공 기술문서 검색 에이전트의 Evidence Evaluator다.
사용자 질문과 검색 결과를 비교해 현재 근거가 답변에 충분한지 판단한다.
불충분하면 허용된 검색 도구 중 하나와 보완 검색어를 제안한다.
허용 도구:
- full_text_search
- vector_search
- hybrid_search
- title_search

반드시 JSON 객체 하나만 출력한다.
스키마:
{"sufficient":true,"next_tool":"hybrid_search","refined_query":"검색어","rationale":"판단 근거"}

현재 근거가 질문에 직접 답할 수 있으면 sufficient=true로 한다.
문서 범위를 확장하거나 새로운 document_id를 제안하지 않는다.
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
            query = str(data.get("query") or question).strip() or question.strip()
            top_k = max(1, min(int(data.get("top_k", fallback_top_k)), 50))
            if requested_top_k is not None:
                top_k = min(top_k, requested_top_k)
            return AgentPlan(
                tool=tool,  # type: ignore[arg-type]
                query=query,
                top_k=top_k,
                rationale=str(data.get("rationale") or "").strip(),
            )
        except (ValueError, TypeError, json.JSONDecodeError):
            return AgentPlan(
                tool="hybrid_search",
                query=question.strip(),
                top_k=fallback_top_k,
                rationale="Planner 응답을 해석하지 못해 안전한 hybrid_search로 대체",
            )


class AgentEvaluator:
    _allowed_tools = AgentPlanner._allowed_tools

    def __init__(self, llm_provider: LLMProvider) -> None:
        self._llm_provider = llm_provider

    async def evaluate(
        self,
        question: str,
        plan: AgentPlan,
        built: BuiltContext,
    ) -> tuple[bool, AgentToolName, str, str]:
        if not built.sources:
            return (
                False,
                "hybrid_search",
                question.strip(),
                "첫 검색에서 근거를 찾지 못해 hybrid 검색으로 재탐색",
            )

        raw = await self._llm_provider.invoke(
            system_prompt=EVALUATOR_SYSTEM_PROMPT,
            user_prompt=(
                f"사용자 질문:\n{question.strip()}\n\n"
                f"현재 검색 도구: {plan.tool}\n"
                f"현재 검색어: {plan.query}\n\n"
                f"현재 검색 근거:\n{built.text}"
            ),
        )
        try:
            start = raw.find("{")
            end = raw.rfind("}")
            if start < 0 or end < start:
                raise ValueError("evaluator did not return a JSON object")
            data = json.loads(raw[start : end + 1])
            if not isinstance(data, dict):
                raise ValueError("evaluator JSON is not an object")
            sufficient = bool(data.get("sufficient", True))
            next_tool_raw = str(data.get("next_tool") or "hybrid_search")
            next_tool: AgentToolName = (
                next_tool_raw if next_tool_raw in self._allowed_tools else "hybrid_search"
            )  # type: ignore[assignment]
            refined_query = str(data.get("refined_query") or question).strip() or question.strip()
            rationale = str(data.get("rationale") or "").strip()
            return sufficient, next_tool, refined_query, rationale
        except (ValueError, TypeError, json.JSONDecodeError):
            return True, plan.tool, plan.query, "Evaluator 응답 해석 실패로 현재 근거를 사용"


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
        self._evaluator = AgentEvaluator(llm_provider)

    async def _retrieve_hits(
        self,
        plan: AgentPlan,
        document_ids: list[int],
    ) -> list[RetrievedChunk]:
        if plan.tool == "full_text_search":
            return await self._retrieval_service.search(
                plan.query, document_ids, mode="keyword", top_k=plan.top_k
            )
        if plan.tool == "vector_search":
            return await self._retrieval_service.search(
                plan.query, document_ids, mode="vector", top_k=plan.top_k
            )
        if plan.tool == "title_search":
            return await self._retrieval_service.title_search(
                plan.query, document_ids, top_k=plan.top_k
            )
        return await self._retrieval_service.search(
            plan.query, document_ids, mode="hybrid", top_k=plan.top_k
        )

    @staticmethod
    def _merge_hits(
        primary: list[RetrievedChunk],
        secondary: list[RetrievedChunk],
        *,
        limit: int,
    ) -> list[RetrievedChunk]:
        merged: list[RetrievedChunk] = []
        seen: set[str] = set()
        for hit in [*primary, *secondary]:
            if hit.chunk_id in seen:
                continue
            seen.add(hit.chunk_id)
            merged.append(hit)
            if len(merged) >= limit:
                break
        return merged

    @staticmethod
    def _answer_prompt(
        question: str,
        plans: list[AgentPlan],
        built: BuiltContext,
    ) -> str:
        route = "\n".join(
            f"- {index}. {plan.tool}: {plan.query}"
            for index, plan in enumerate(plans, start=1)
        )
        return (
            f"질문:\n{question.strip()}\n\n"
            f"에이전트 검색 경로:\n{route}\n\n"
            f"검색 문맥:\n{built.text}\n\n"
            "위 문맥만 근거로 한국어로 답변하세요."
        )

    async def _run_search_loop(
        self,
        question: str,
        document_ids: list[int],
        *,
        top_k: int | None = None,
    ) -> tuple[AgentPlan, list[AgentPlan], BuiltContext, tuple[bool, AgentToolName, str, str]]:
        plan = await self._planner.plan(question, requested_top_k=top_k)
        first_hits = await self._retrieve_hits(plan, document_ids)
        first_built = self._context_builder.build(first_hits)
        evaluation = await self._evaluator.evaluate(question, plan, first_built)
        sufficient, next_tool, refined_query, rationale = evaluation
        plans = [plan]

        if sufficient:
            return plan, plans, first_built, evaluation

        retry_plan = AgentPlan(
            tool=next_tool,
            query=refined_query,
            top_k=plan.top_k,
            rationale=rationale or "근거 보강을 위한 재검색",
        )
        retry_hits = await self._retrieve_hits(retry_plan, document_ids)
        merged = self._merge_hits(
            retry_hits,
            first_hits,
            limit=max(plan.top_k * 2, retry_plan.top_k),
        )
        plans.append(retry_plan)
        return plan, plans, self._context_builder.build(merged), evaluation

    async def answer(
        self,
        question: str,
        document_ids: list[int],
        *,
        top_k: int | None = None,
    ) -> AgentAnswer:
        if not document_ids:
            raise ValueError("document_ids must not be empty")
        plan, plans, built, _ = await self._run_search_loop(
            question,
            document_ids,
            top_k=top_k,
        )
        if not built.sources:
            return AgentAnswer(
                answer="선택한 문서 범위에서 질문과 관련된 근거를 찾지 못했습니다.",
                plan=plan,
                sources=(),
            )
        answer = await self._llm_provider.invoke(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=self._answer_prompt(question, plans, built),
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

        yield "step", {
            "id": "analyze",
            "title": "질문 분석 및 계획",
            "status": "running",
            "detail": "질문의 의도와 적합한 검색 도구를 판단하고 있습니다.",
        }
        plan = await self._planner.plan(question, requested_top_k=top_k)
        yield "plan", plan
        yield "step", {
            "id": "analyze",
            "title": "질문 분석 및 계획",
            "status": "done",
            "detail": plan.rationale or f"{plan.tool} 선택",
            "tool": plan.tool,
            "query": plan.query,
        }

        yield "step", {
            "id": "retrieve-1",
            "title": "1차 문서 검색",
            "status": "running",
            "detail": f"{plan.tool} · {plan.query}",
            "tool": plan.tool,
            "query": plan.query,
        }
        first_hits = await self._retrieve_hits(plan, document_ids)
        first_built = self._context_builder.build(first_hits)
        yield "step", {
            "id": "retrieve-1",
            "title": "1차 문서 검색",
            "status": "done",
            "detail": f"{len(first_built.sources)}개 근거 후보 확보",
            "tool": plan.tool,
            "query": plan.query,
        }

        yield "step", {
            "id": "evaluate",
            "title": "근거 적합성 검토",
            "status": "running",
            "detail": "검색 결과가 질문에 충분한지 검토하고 있습니다.",
        }
        sufficient, next_tool, refined_query, rationale = await self._evaluator.evaluate(
            question,
            plan,
            first_built,
        )
        yield "step", {
            "id": "evaluate",
            "title": "근거 적합성 검토",
            "status": "done",
            "detail": rationale or ("현재 근거로 답변 가능" if sufficient else "추가 검색 필요"),
            "decision": "sufficient" if sufficient else "retry",
        }

        plans = [plan]
        built = first_built
        if not sufficient:
            retry_plan = AgentPlan(
                tool=next_tool,
                query=refined_query,
                top_k=plan.top_k,
                rationale=rationale or "근거 보강을 위한 재검색",
            )
            plans.append(retry_plan)
            yield "step", {
                "id": "refine",
                "title": "검색 전략 보정",
                "status": "done",
                "detail": retry_plan.rationale,
                "tool": retry_plan.tool,
                "query": retry_plan.query,
            }
            yield "step", {
                "id": "retrieve-2",
                "title": "2차 보완 검색",
                "status": "running",
                "detail": f"{retry_plan.tool} · {retry_plan.query}",
                "tool": retry_plan.tool,
                "query": retry_plan.query,
            }
            retry_hits = await self._retrieve_hits(retry_plan, document_ids)
            merged_hits = self._merge_hits(
                retry_hits,
                first_hits,
                limit=max(plan.top_k * 2, retry_plan.top_k),
            )
            built = self._context_builder.build(merged_hits)
            yield "step", {
                "id": "retrieve-2",
                "title": "2차 보완 검색",
                "status": "done",
                "detail": f"중복 제거 후 {len(built.sources)}개 근거 확보",
                "tool": retry_plan.tool,
                "query": retry_plan.query,
            }

        yield "sources", built.sources
        if not built.sources:
            yield "step", {
                "id": "answer",
                "title": "답변 생성",
                "status": "done",
                "detail": "답변에 사용할 근거를 찾지 못했습니다.",
            }
            yield "token", "선택한 문서 범위에서 질문과 관련된 근거를 찾지 못했습니다."
            yield "done", {"tool": plan.tool, "iterations": len(plans)}
            return

        yield "step", {
            "id": "answer",
            "title": "근거 기반 답변 생성",
            "status": "running",
            "detail": f"{len(built.sources)}개 근거를 바탕으로 응답을 생성합니다.",
        }
        async for token in self._llm_provider.stream(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=self._answer_prompt(question, plans, built),
        ):
            yield "token", token
        yield "step", {
            "id": "answer",
            "title": "근거 기반 답변 생성",
            "status": "done",
            "detail": "답변 생성 완료",
        }
        yield "done", {"tool": plan.tool, "iterations": len(plans)}
