from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class LLMMessage:
    role: str
    content: str


@dataclass(frozen=True, slots=True)
class LLMResponse:
    content: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class LLMChunk:
    content: str
    finish_reason: str | None = None


class LLMProvider(Protocol):
    async def invoke(self, messages: Sequence[LLMMessage]) -> LLMResponse: ...

    def stream(self, messages: Sequence[LLMMessage]) -> AsyncIterator[LLMChunk]: ...
