# Book Viewer V2 폐쇄망 배포 절차

## 1. 구성

- Backend: FastAPI, PostgreSQL, Elasticsearch, bge-m3 embedding, LiteLLM/vLLM
- Frontend: Next.js 15 standalone output
- 검색 인덱스: `rag-documents` alias
- 기본 LLM: 실제 LiteLLM 등록 이름 `gpt-oss120b`

## 2. 인터넷 PC 검증

```cmd
cd /d C:\Users\Internet\Desktop\book-viewer-v2
python -m pytest -q

cd frontend
npm install --no-audit --no-fund
npm run typecheck
set NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:9056
npm run build
```

Next standalone 산출물은 `frontend\.next\standalone`에 생성된다. `.next\static`은 standalone에 자동 포함되지 않으므로 배포 폴더에 복사한다.

```cmd
cd /d C:\Users\Internet\Desktop\book-viewer-v2\frontend
xcopy /E /I /Y .next\static .next\standalone\.next\static
```

`public` 폴더를 나중에 사용하게 되면 동일하게 `.next\standalone\public`으로 복사한다.

## 3. USB 반입 대상

1. Git bundle
2. `frontend\.next\standalone` 전체 폴더
3. 기존 Python conda-pack 환경 또는 검증된 wheelhouse
4. `.env`는 폐쇄망에서 관리하고 API key를 bundle이나 Git에 넣지 않는다.

파일 하나가 300MB를 초과하면 폐쇄망 반입 규칙에 따라 분할 압축한다. 크기 확인 후 필요할 때만 7-Zip/반디집 분할을 사용한다.

## 4. 폐쇄망 코드 반영

```cmd
cd /d D:\project\book-viewer-v2
git fetch D:\transfer\phase-08-09-frontend-eval-offline.bundle work/phase-08-09-frontend-eval-offline
git switch -c work/phase-08-09-frontend-eval-offline FETCH_HEAD
```

이미 브랜치가 있으면:

```cmd
git switch work/phase-08-09-frontend-eval-offline
git merge --ff-only FETCH_HEAD
```

## 5. Backend 환경

`.env` 핵심값:

```env
APP_PORT=9056
CORS_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
ES_DOCUMENT_ALIAS=rag-documents
EMBEDDING_MODEL=bge-m3
LITELLM_BASE_URL=http://<실제-IP>:4070/v1
LLM_MODEL=gpt-oss120b
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:9056
```

PostgreSQL, Elasticsearch, embedding URL/API key 등은 기존 폐쇄망 검증값을 유지한다.

## 6. Backend 실행

```cmd
cd /d D:\project\book-viewer-v2\backend
uvicorn app.main:app --host 0.0.0.0 --port 9056
```

확인:

```cmd
curl.exe http://127.0.0.1:9056/health
curl.exe http://127.0.0.1:9056/ready
```

## 7. Frontend standalone 실행

인터넷 PC에서 생성한 standalone 폴더를 예를 들어 다음 위치에 복사한다.

```text
D:\project\book-viewer-v2-frontend-standalone
```

실행:

```cmd
cd /d D:\project\book-viewer-v2-frontend-standalone
set HOSTNAME=0.0.0.0
set PORT=3000
node server.js
```

브라우저:

```text
http://127.0.0.1:3000
```

`NEXT_PUBLIC_API_BASE_URL`은 Next build 시 클라이언트 번들에 포함되므로 인터넷 PC build 단계에서 폐쇄망에서 사용할 Backend 주소로 지정해야 한다. Backend와 Frontend를 같은 PC에서 실행하는 현재 구성은 `http://127.0.0.1:9056`을 사용한다.

## 8. UI E2E 검증

1. 문서 목록 24개가 로드되는지 확인
2. 문서 한 개 선택 → 목차/본문 로드
3. 문서 여러 개 선택 → 검색 범위 숫자 증가
4. Hybrid RAG 질문 → sources → token streaming → 답변 완료
5. Agent 질문 → plan 표시 → sources → token streaming
6. 출처 카드 클릭 → 해당 document/page/content로 viewer 이동
7. 다른 문서 ID가 selected scope 밖에서 source로 노출되지 않는지 확인

## 9. 평가

Retrieval 기존 평가:

```cmd
cd /d D:\project\book-viewer-v2\backend
python scripts\evaluate_retrieval.py <retrieval-dataset.jsonl> --mode hybrid --top-k 5
```

Agent 평가:

```cmd
python scripts\evaluate_agent.py ..\evaluation\agent_eval.example.jsonl --top-k 5
```

실제 평가셋에서는 `expected_content_ids`를 채운다. Agent 평가 시 최소 확인 지표:

- Hit@K
- tool accuracy (expected_tool이 있는 케이스)
- scope violations = 0

Agent tool 선택은 생성 모델의 판단이므로 모든 자연어 질문에서 고정적인 tool accuracy 100%를 요구하지 않는다. 대신 document scope 위반은 반드시 0이어야 한다.

## 10. 최종 배포 체크리스트

- `python -m pytest -q` PASS
- Frontend `npm run typecheck` PASS
- Frontend `npm run build` PASS
- `/health`, `/ready` 정상
- 문서 목록/TOC/본문 정상
- Hybrid RAG streaming 정상
- Agentic RAG streaming 정상
- source click navigation 정상
- multi-document scope 위반 없음
- `rag-documents` alias가 검증된 V2 index를 가리킴
- API key/비밀번호 Git 미포함
