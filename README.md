# Book Viewer V2

Clean-room rebuild of the Booklet RAG viewer and chatbot.

> `main` is reserved for code that has passed the project validation flow. Active development happens on phase branches and is merged through pull requests.

## 폐쇄망 Windows 백엔드 실행

폐쇄망 개발 PC에서는 CMD를 새로 열 때 먼저 Miniconda 초기화 스크립트를 호출한 뒤 Conda 가상환경을 활성화한다. 현재 PC에서는 `conda init cmd.exe`만으로 `conda` 명령이 바로 활성화되지 않으므로 아래 순서를 사용한다.

```cmd
call C:\ProgramData\miniconda3\Scripts\activate.bat
conda activate bookviewer-v2-py312
cd /d D:\project\book-viewer-v2\backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 9056
```

가상환경이 정상적으로 활성화되었는지 확인하려면 다음 명령을 사용한다.

```cmd
where python
python --version
```

`conda activate bookviewer-v2-py312`에서 환경을 찾지 못하는 경우에는 `conda env list`로 등록된 환경 이름/경로를 확인한다.

```cmd
conda env list
```

운영 서버에서 압축 해제한 Python 환경을 직접 사용하는 경우에는 Conda 활성화 없이 다음과 같이 실행할 수 있다.

```cmd
cd /d D:\runtime\book-viewer-v2-backend
D:\runtime\bookviewer-v2-py312\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9056
```
