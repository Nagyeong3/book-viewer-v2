from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.container import get_llm_provider
from app.infrastructure.llm.litellm import LiteLLMProvider

router = APIRouter(prefix="/api/translation", tags=["translation"])

LANGUAGE_NAMES = {
    "en": "English",
    "ja": "Japanese",
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
}


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=12000)
    target_language: str = Field(min_length=2, max_length=10)


class TranslateResponse(BaseModel):
    translated_text: str
    target_language: str


@router.post("", response_model=TranslateResponse)
async def translate(
    payload: TranslateRequest,
    llm: LiteLLMProvider = Depends(get_llm_provider),
) -> TranslateResponse:
    language = LANGUAGE_NAMES.get(payload.target_language)
    if language is None:
        raise HTTPException(status_code=400, detail="unsupported target_language")

    system_prompt = (
        "You are a technical-document translation engine. "
        "Translate faithfully without adding explanations, summaries, markdown, or commentary. "
        "Preserve technical terms, numbers, model names, symbols, abbreviations, and procedural meaning."
    )
    user_prompt = (
        f"Target language: {language}\n\n"
        "Translate only the following source text. Return only the translated text.\n\n"
        f"{payload.text.strip()}"
    )
    translated = await llm.invoke(system_prompt=system_prompt, user_prompt=user_prompt)
    return TranslateResponse(translated_text=translated, target_language=payload.target_language)
