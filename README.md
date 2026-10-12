# Book Viewer V2

Clean-room rebuild of the Booklet RAG viewer and chatbot.

> `main` is reserved for code that has passed the project validation flow. Active development happens on phase branches and is merged through pull requests.

## 폐쇄망 Windows 백엔드 실행

폐쇄망 개발 PC에서 backend 폴더 안에 생성한 Conda 가상환경을 활성화한 뒤 Uvicorn을 실행한다.

```cmd
cd /d D:\project\book-viewer-v2\backend
conda activate D:\project\book-viewer-v2\backend\bookviewer-v2-py312
python -m uvicorn app.main:app --host 0.0.0.0 --port 9056
```

가상환경이 정상적으로 활성화되었는지 확인하려면 다음 명령을 사용한다.

```cmd
where python
python --version
```

`conda activate`가 동작하지 않거나 환경 이름으로 찾지 못하는 경우에는 위 예시처럼 환경의 전체 경로를 지정한다. 가상환경 위치가 다른 PC에서는 실제 `bookviewer-v2-py312` 폴더 경로로 바꿔 실행한다.

운영 서버에서 압축 해제한 Python 환경을 직접 사용하는 경우에는 Conda 활성화 없이 다음과 같이 실행할 수 있다.

```cmd
cd /d D:\runtime\book-viewer-v2-backend
D:\runtime\bookviewer-v2-py312\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9056
```
