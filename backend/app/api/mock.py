from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

router = APIRouter()

DOCUMENTS = [
    {"id": 101, "title": "LAH 정비교범 샘플"},
    {"id": 102, "title": "지원장비 운용교범 샘플"},
]

TOC = {
    101: [
        {
            "id": 1001,
            "text": "제 1 장 총론",
            "doc_level": 1,
            "title_num": "1",
            "page": 1,
            "order_index": 0,
            "children": [
                {
                    "id": 1002,
                    "text": "제 1 절 개요",
                    "doc_level": 2,
                    "title_num": "1.1",
                    "page": 1,
                    "order_index": 1,
                    "children": [
                        {
                            "id": 1003,
                            "text": "적용 범위",
                            "doc_level": 3,
                            "title_num": "1.1.1",
                            "page": 2,
                            "order_index": 2,
                            "children": [],
                        }
                    ],
                }
            ],
        },
        {
            "id": 1010,
            "text": "제 2 장 운용",
            "doc_level": 1,
            "title_num": "2",
            "page": 4,
            "order_index": 10,
            "children": [
                {
                    "id": 1011,
                    "text": "제 1 절 운용 절차",
                    "doc_level": 2,
                    "title_num": "2.1",
                    "page": 4,
                    "order_index": 11,
                    "children": [
                        {
                            "id": 1012,
                            "text": "운용 종료",
                            "doc_level": 3,
                            "title_num": "2.1.1",
                            "page": 5,
                            "order_index": 12,
                            "children": [],
                        }
                    ],
                }
            ],
        },
    ],
    102: [
        {
            "id": 2001,
            "text": "제 1 장 장비 개요",
            "doc_level": 1,
            "title_num": "1",
            "page": 1,
            "order_index": 0,
            "children": [],
        }
    ],
}

def box(x1: float, y1: float, x2: float, y2: float) -> dict[str, float]:
    return {"xmin": x1, "ymin": y1, "xmax": x2, "ymax": y2}

def item(
    content_id: int,
    document_id: int,
    page: int,
    order_index: int,
    content_type: str,
    text: str | None,
    bbox: dict[str, float],
    *,
    level: int | None = None,
    parent_id: int | None = None,
    title_num: str | None = None,
    cropped_image_path: str | None = None,
) -> dict[str, Any]:
    return {
        "id": content_id,
        "document_id": document_id,
        "text": text,
        "content_type": content_type,
        "doc_level": level,
        "parent_id": parent_id,
        "order_index": order_index,
        "page": page,
        "cropped_image_path": cropped_image_path,
        "doc_image_path": f"origin/page_{page:03d}.svg",
        "bbox": bbox,
        "title_num": title_num,
    }

CONTENTS = {
    101: [
        item(1101, 101, 1, 0, "title", "제 1 장 총론", box(110, 110, 1130, 200), level=1, title_num="1"),
        item(1102, 101, 1, 1, "sub_title", "제 1 절 개요", box(120, 245, 1120, 310), level=2, parent_id=1101, title_num="1.1"),
        item(1103, 101, 1, 2, "text", "본 교범은 항공기 후속지원 업무를 위한 샘플 문서입니다. 집에서 UI와 상호작용을 개발하기 위한 Mock 데이터입니다.", box(130, 350, 1120, 520), level=3, parent_id=1102),
        item(1104, 101, 1, 3, "image", "구성 개념도", box(250, 620, 1000, 1180), cropped_image_path="cropped/diagram.svg"),
        item(1201, 101, 2, 4, "title", "1.1.1 적용 범위", box(110, 120, 1130, 210), level=3, parent_id=1102, title_num="1.1.1"),
        item(1202, 101, 2, 5, "text", "정비, 운용, 지원장비 정보의 전산화와 검색 기능을 검증합니다.", box(130, 280, 1120, 430), level=4, parent_id=1201),
        item(1203, 101, 2, 6, "table", "<table border='1'><thead><tr><th>구분</th><th>상태</th><th>비고</th></tr></thead><tbody><tr><td>문서 뷰어</td><td>정상</td><td>연속 스크롤</td></tr><tr><td rowspan='2'>RAG</td><td>Mock</td><td>검색 결과 고정</td></tr><tr><td>Streaming</td><td>토큰 스트림</td></tr></tbody></table>", box(120, 520, 1130, 940), level=4, parent_id=1201),
        item(1301, 101, 3, 7, "sub_title", "운용 전 확인사항", box(110, 140, 1130, 220), level=2, title_num="1.2"),
        item(1302, 101, 3, 8, "text", "다음 장으로 넘어가기 전 필요한 점검 항목을 확인합니다.", box(130, 290, 1120, 500), level=3),
        item(1401, 101, 4, 9, "title", "제 2 장 운용", box(110, 110, 1130, 200), level=1, title_num="2"),
        item(1402, 101, 4, 10, "sub_title", "제 1 절 운용 절차", box(120, 245, 1120, 310), level=2, parent_id=1401, title_num="2.1"),
        item(1403, 101, 4, 11, "text", "이 페이지는 챕터 경계를 넘어 연속 로딩되는지 확인하기 위한 샘플입니다.", box(130, 360, 1120, 560), level=3, parent_id=1402),
        item(1501, 101, 5, 12, "text", "문서의 마지막 샘플 페이지입니다.", box(130, 300, 1120, 470), level=3),
    ],
    102: [
        item(2101, 102, 1, 0, "title", "제 1 장 장비 개요", box(110, 110, 1130, 200), level=1, title_num="1"),
        item(2102, 102, 1, 1, "text", "두 번째 문서는 다중 문서 선택과 RAG 검색 범위 UI를 검증하기 위한 샘플입니다.", box(130, 320, 1120, 520), level=2),
    ],
}

INDEX_STATE: dict[int, dict[str, Any]] = {
    101: {"document_id": 101, "state": "ready", "indexed_chunks": 13, "message": "Mock 벡터 DB 구축 완료"},
    102: {"document_id": 102, "state": "missing", "indexed_chunks": 0, "message": None},
}

def _document(document_id: int) -> dict[str, Any]:
    for document in DOCUMENTS:
        if document["id"] == document_id:
            return document
    raise HTTPException(status_code=404, detail="document not found")

def _sources(document_ids: list[int]) -> list[dict[str, Any]]:
    result = []
    for index, document_id in enumerate(document_ids[:3], start=1):
        document = _document(document_id)
        first = CONTENTS[document_id][0]
        result.append(
            {
                "source_id": f"S{index}",
                "chunk_id": f"{document_id}:{first['id']}",
                "document_id": document_id,
                "document_name": document["title"],
                "content_id": first["id"],
                "page": first["page"],
                "title_path": [first["text"] or "문서"],
                "text": "Mock 검색 결과입니다. 실제 회사 환경에서는 Elasticsearch 검색 결과로 대체됩니다.",
                "score": round(0.95 - index * 0.05, 3),
                "content_type": first["content_type"],
                "keyword_score": 0.8,
                "vector_score": 0.9,
            }
        )
    return result

def _ensure_ready(document_ids: list[int]) -> None:
    missing = [document_id for document_id in document_ids if INDEX_STATE.get(document_id, {}).get("state") != "ready"]
    if missing:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "DOCUMENTS_NOT_INDEXED",
                "message": "선택한 문서 중 벡터 DB가 구축되지 않은 문서가 있습니다.",
                "document_ids": missing,
            },
        )

def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

async def _finish_index(document_id: int) -> None:
    INDEX_STATE[document_id] = {
        "document_id": document_id,
        "state": "indexing",
        "indexed_chunks": 0,
        "message": "Mock 인덱싱 진행 중",
    }
    await asyncio.sleep(2.2)
    INDEX_STATE[document_id] = {
        "document_id": document_id,
        "state": "ready",
        "indexed_chunks": len(CONTENTS.get(document_id, [])),
        "message": "Mock 벡터 DB 구축 완료",
    }

@router.get("/api/documents")
async def list_documents():
    return DOCUMENTS

@router.get("/api/documents/{document_id}")
async def get_document(document_id: int):
    return _document(document_id)

@router.get("/api/documents/{document_id}/toc")
async def get_toc(document_id: int):
    _document(document_id)
    return TOC.get(document_id, [])

@router.get("/api/documents/{document_id}/contents")
async def list_contents(document_id: int, page: int | None = Query(default=None, ge=1)):
    _document(document_id)
    values = CONTENTS.get(document_id, [])
    return values if page is None else [entry for entry in values if entry["page"] == page]

@router.get("/api/documents/{document_id}/contents/{content_id}")
async def get_content(document_id: int, content_id: int):
    _document(document_id)
    for entry in CONTENTS.get(document_id, []):
        if entry["id"] == content_id:
            return entry
    raise HTTPException(status_code=404, detail="content not found")

@router.get("/api/search")
async def unsupported_get_search():
    raise HTTPException(status_code=405, detail="use POST")

@router.post("/api/search")
async def search(payload: dict[str, Any]):
    document_ids = [int(value) for value in payload.get("document_ids", [])]
    top_k = int(payload.get("top_k", 8))
    return _sources(document_ids)[:top_k]

@router.get("/api/indexing/documents")
async def list_index_status(document_ids: list[int] | None = Query(default=None)):
    ids = document_ids or [document["id"] for document in DOCUMENTS]
    return [INDEX_STATE.setdefault(document_id, {"document_id": document_id, "state": "missing", "indexed_chunks": 0, "message": None}) for document_id in ids]

@router.get("/api/indexing/documents/{document_id}")
async def get_index_status(document_id: int):
    _document(document_id)
    return INDEX_STATE.setdefault(document_id, {"document_id": document_id, "state": "missing", "indexed_chunks": 0, "message": None})

@router.post("/api/indexing/documents/{document_id}", status_code=202)
async def build_index(document_id: int):
    _document(document_id)
    current = INDEX_STATE.get(document_id)
    if current and current["state"] in {"queued", "indexing"}:
        return current
    INDEX_STATE[document_id] = {
        "document_id": document_id,
        "state": "queued",
        "indexed_chunks": 0,
        "message": "Mock 벡터 DB 구축 대기 중",
    }
    asyncio.create_task(_finish_index(document_id))
    return INDEX_STATE[document_id]

@router.post("/api/rag/query")
async def rag_query(payload: dict[str, Any]):
    document_ids = [int(value) for value in payload.get("document_ids", [])]
    _ensure_ready(document_ids)
    return {
        "answer": "Mock RAG 답변입니다. 실제 환경에서는 gpt-oss120b 응답으로 대체됩니다.",
        "mode": payload.get("mode", "hybrid"),
        "sources": _sources(document_ids),
    }

@router.post("/api/agent/query")
async def agent_query(payload: dict[str, Any]):
    document_ids = [int(value) for value in payload.get("document_ids", [])]
    _ensure_ready(document_ids)
    return {
        "answer": "Mock Agent 답변입니다.",
        "plan": {
            "tool": "hybrid_search",
            "query": payload.get("question", ""),
            "top_k": payload.get("top_k") or 5,
            "rationale": "오프라인 프로토타입용 고정 Agent 계획",
        },
        "sources": _sources(document_ids),
    }

async def _stream_answer(document_ids: list[int], *, agent: bool, question: str, top_k: int) -> AsyncIterator[str]:
    _ensure_ready(document_ids)
    if agent:
        yield _sse(
            "plan",
            {
                "tool": "hybrid_search",
                "query": question,
                "top_k": top_k,
                "rationale": "Mock 환경에서 Hybrid 검색을 선택했습니다.",
            },
        )
    yield _sse("sources", _sources(document_ids))
    for token in ["Mock ", "오프라인 ", "환경에서 ", "스트리밍되는 ", "답변입니다. ", "실환경 연동 없이 UI를 개발할 수 있습니다."]:
        await asyncio.sleep(0.12)
        yield _sse("token", token)
    yield _sse("done", {"ok": True})

@router.post("/api/rag/stream")
async def rag_stream(payload: dict[str, Any]) -> StreamingResponse:
    document_ids = [int(value) for value in payload.get("document_ids", [])]
    _ensure_ready(document_ids)
    return StreamingResponse(
        _stream_answer(
            document_ids,
            agent=False,
            question=str(payload.get("question", "")),
            top_k=int(payload.get("top_k") or 5),
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.post("/api/agent/stream")
async def agent_stream(payload: dict[str, Any]) -> StreamingResponse:
    document_ids = [int(value) for value in payload.get("document_ids", [])]
    _ensure_ready(document_ids)
    return StreamingResponse(
        _stream_answer(
            document_ids,
            agent=True,
            question=str(payload.get("question", "")),
            top_k=int(payload.get("top_k") or 5),
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.post("/api/translation")
async def mock_translate(payload: dict[str, Any]):
    text = str(payload.get("text", "")).strip()
    target = str(payload.get("target_language", "en"))
    if not text:
        raise HTTPException(status_code=422, detail="text is required")
    labels = {
        "en": "English",
        "ja": "日本語",
        "zh-CN": "简体中文",
        "zh-TW": "繁體中文",
        "es": "Español",
        "fr": "Français",
        "de": "Deutsch",
    }
    language = labels.get(target, target)
    samples = {
        "en": f"[Mock {language}] {text}",
        "ja": f"[Mock {language}] {text}",
        "zh-CN": f"[Mock {language}] {text}",
        "zh-TW": f"[Mock {language}] {text}",
        "es": f"[Mock {language}] {text}",
        "fr": f"[Mock {language}] {text}",
        "de": f"[Mock {language}] {text}",
    }
    await asyncio.sleep(0.35)
    return {"translated_text": samples.get(target, f"[Mock {language}] {text}"), "target_language": target}


@router.get("/mock-assets/{path:path}")
async def mock_asset(path: str) -> Response:
    if path.startswith("cropped/"):
        svg = """<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620" viewBox="0 0 900 620">
        <rect width="900" height="620" rx="18" fill="#f4f6fb"/>
        <rect x="90" y="90" width="210" height="120" rx="12" fill="#dbe4ff" stroke="#6b83dc" stroke-width="4"/>
        <rect x="600" y="90" width="210" height="120" rx="12" fill="#e7f6ee" stroke="#5b9b75" stroke-width="4"/>
        <rect x="345" y="390" width="210" height="120" rx="12" fill="#fff0d8" stroke="#c68a36" stroke-width="4"/>
        <path d="M300 150 H600 M705 210 L500 390 M195 210 L400 390" fill="none" stroke="#8792a8" stroke-width="6"/>
        <text x="195" y="160" text-anchor="middle" font-size="30" font-family="sans-serif" fill="#26354f">OCR</text>
        <text x="705" y="160" text-anchor="middle" font-size="30" font-family="sans-serif" fill="#26354f">RAG</text>
        <text x="450" y="460" text-anchor="middle" font-size="30" font-family="sans-serif" fill="#26354f">Viewer</text>
        </svg>"""
    else:
        svg = """<svg xmlns="http://www.w3.org/2000/svg" width="1250" height="1755" viewBox="0 0 1250 1755">
        <rect width="1250" height="1755" fill="#ffffff"/>
        <rect x="40" y="40" width="1170" height="1675" fill="none" stroke="#d9dee7" stroke-width="3"/>
        <text x="625" y="1685" text-anchor="middle" font-size="24" font-family="sans-serif" fill="#9aa3b1">Mock document page</text>
        </svg>"""
    return Response(content=svg, media_type="image/svg+xml")
