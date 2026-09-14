from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.core.container import AppContainer, get_container

router = APIRouter(tags=["system"])


@router.get("/ready")
async def readiness(container: AppContainer = Depends(get_container)):
    if container.postgres_pool is None:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "database": "not_configured"},
        )
    try:
        ok = await container.postgres_pool.ping()
    except Exception:
        ok = False
    if not ok:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "database": "unavailable"},
        )
    return {"status": "ready", "database": "ok"}
