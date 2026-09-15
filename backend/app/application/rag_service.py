from __future__ import annotations

from collections.abc import AsyncIterator

from app.application.context_builder import BuiltContext, ContextBuilder
from app.application.retrieval_service import RetrievalService
from app.domain.models.rag import RagAnswer, RetrievalMode
from app.domain.ports.retrieval import LLMProvider


SYSTEM_PROMPT = """당신은 항공 기술문서 질의응답 도우미다.
반드시 제공된 검색 문맥만 사용해서 답변한다.
문맥에 근거가 없으면 모른다고 명확히 말한다.
답변의 각 핵심 주장 뒤에는 [S1], [S2] 같은 출처 번호를 붙인다.
출처 번호는 제공된 문맥의 번호만 사용하고, 존재하지 않는 출처를 만들지 않는다.
기술 용어와 수치, 절차 순서는 문맥을 임의로 바꾸지 않는다.
"""


class RagService:
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
        self._default_top_k = default_top_k

    async def prepare(
        self,
        question: str,
        document_ids: list[int],
        *,
        mode: RetrievalMode = "hybrid",
        top_k: int | None = None,
    ) -> BuiltContext:
        hits = await self._retrieval_service.search(
            question,
            document_ids,
            mode=mode,
            top_k=top_k or self._default_top_k,
        )
        return self._context_builder.build(hits)

    @staticmethod
    def _user_prompt(question: str, built: BuiltContext) -> str:
        return (
            f"질문:\n{question.strip()}\n\n"
            f"검색 문맥:\n{built.text}\n\n"
            "위 문맥만 근거로 한국어로 답변하세요."
        )

    async def answer(
        self,
        question: str,
        document_ids: list[int],
        *,
        mode: RetrievalMode = "hybrid",
        top_k: int | None = None,
    ) -> RagAnswer:
        built = await self.prepare(
            question,
            document_ids,
            mode=mode,
            top_k=top_k,
        )
        if not built.sources:
            return RagAnswer(
                answer="선택한 문서 범위에서 질문과 관련된 근거를 찾지 못했습니다.",
                mode=mode,
                sources=(),
            )

        answer = await self._llm_provider.invoke(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=self._user_prompt(question, built),
        )
        return RagAnswer(answer=answer, mode=mode, sources=built.sources)

    async def stream_answer(
        self,
        question: str,
        document_ids: list[int],
        *,
        mode: RetrievalMode = "hybrid",
        top_k: int | None = None,
    ) -> AsyncIterator[tuple[str, object]]:
        built = await self.prepare(
            question,
            document_ids,
            mode=mode,
            top_k=top_k,
        )
        yield "sources", built.sources
        if not built.sources:
            yield "token", "선택한 문서 범위에서 질문과 관련된 근거를 찾지 못했습니다."
            yield "done", {"mode": mode}
            return

        async for token in self._llm_provider.stream(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=self._user_prompt(question, built),
        ):
            yield "token", token
        yield "done", {"mode": mode}
