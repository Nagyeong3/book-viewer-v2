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
