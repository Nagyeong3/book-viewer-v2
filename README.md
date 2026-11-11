# Book Viewer V2

Clean-room rebuild of the Booklet RAG viewer and chatbot.

> `main` is reserved for code that has passed the project validation flow. Active development happens on phase branches and is merged through pull requests.

## 폐쇄망 Windows 백엔드 실행

폐쇄망 개발 PC에서는 CMD를 새로 열 때 먼저 Miniconda 초기화 스크립트를 호출한 뒤 Conda 가상환경을 활성화한다. 현재 PC에서는 `conda init cmd.exe`만으로 `conda` 명령이 바로 활성화되지 않으므로 아래 순서를 사용한다.

```cmd
call C:\ProgramData\miniconda3\Scripts\activate.bat
conda activate D:\project\book-viewer-v2\bookviewer-v2-py312
cd /d D:\project\book-viewer-v2\backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 9056
```

가상환경이 정상적으로 활성화되었는지 확인하려면 다음 명령을 사용한다.

```cmd
where python
python --version
```

Conda 환경 이름이 등록되지 않아 `EnvironmentNameNotFound`가 발생할 수 있다. 폐쇄망 개발 PC에서는 위와 같이 환경 폴더의 절대경로를 지정해 활성화한다. 실제 경로가 다르면 `conda env list`와 폴더 구조를 확인한다.

```cmd
conda env list
```

운영 서버에서 압축 해제한 Python 환경을 직접 사용하는 경우에는 Conda 활성화 없이 다음과 같이 실행할 수 있다.

```cmd
cd /d D:\runtime\book-viewer-v2-backend
D:\runtime\bookviewer-v2-py312\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9056
```

## Keycloak 로그인 / 계정 전환

개발 프론트(`http://166.103.117.58:3000`)와 운영 프론트(`http://166.103.117.128:3002`)는 Keycloak 클라이언트 `book-viewer-v2`를 공유한다. 각 프론트의 정확한 `/auth/callback`을 Keycloak Valid redirect URIs에, 두 Origin을 Web origins에 등록한다. 백엔드 `CORS_ALLOWED_ORIGINS`에도 프론트 Origin을 허용하고 백엔드를 재시작한다.

인증/권한 오류의 **다른 계정으로 로그인** 기능은 로컬 인증정보를 정리하고 Keycloak에 `prompt=login`으로 새 로그인을 요청한다. 화면에 `Failed to fetch` 등 내부 예외 문자열을 그대로 노출하지 않는다.


## 기술문서 접근 권한 관리 (개발 브랜치)

관리자 전용 **벡터 DB** 및 **문서 권한관리** 메뉴는 Keycloak `/api/auth/me`의 role=admin 판정 후 표시한다. 일반 사용자는 PostgreSQL에서 허용된 문서만 문서 탐색 목록에 표시된다. 권한은 그룹의 Keycloak **전체 경로** 또는 사용자 고유 `sub` ID로 부여한다.

배포 전 폐쇄망 PostgreSQL 데이터베이스에서 `migrations/20261111_document_access.sql`을 반드시 한 번 실행한다. migration은 기존 `documents` 테이블을 참조하며 다른 문서/콘텐츠 테이블은 변경하지 않는다. 신규 문서는 기본적으로 일반 사용자에게 **비공개**이며, 관리자에게만 기본 열람 권한이 있다.

1. 백엔드 `.env`: `APP_PROFILE=real`, `AUTH_MODE=keycloak`, `DATABASE_URL`, Keycloak 설정 확인.
2. 프론트 Origin을 `CORS_ALLOWED_ORIGINS=http://166.103.117.58:3000,http://166.103.117.128:3002`에 등록하고 백엔드 재시작. `OPTIONS /api/auth/me`이 200인지 확인.
3. 관리자 로그인 → **문서 권한관리** → 문서 선택 → 그룹 및 사용자 ID 지정 → 저장.
4. 일반 사용자 로그인 → 허가된 문서만 표시되는지, 허가되지 않은 문서의 API/검색/RAG/Agent 요청이 403인지 확인.
5. 앱 문서 검색 권한은 DB의 ACL에 의해 제어되지만, 기존 SeaweedFS 파일 직접 URL이 외부에서 접근 가능하다면 이미지까지 완전히 보호되지 않는다. 운영 반입 전에 filer 공개 접근을 차단하고 인증 미디어 프록시 적용 여부를 반드시 검증해야 한다.
6. 권한 변경 후 기존 탭은 문서를 새로 고치거나 재로그인하여 목록을 갱신한다. 관리자 화면 저장 시 현재 브라우저에서만 문서 목록 새로고침 이벤트가 발생한다.

개발 PC/CI 검증: `python -m pytest -q` (repo root), `cd frontend && npm run typecheck && npm run build`; Playwright UI smoke는 1600/1366/768/375px에서 문서 권한관리 화면 및 버튼 노출을 검증한다.
