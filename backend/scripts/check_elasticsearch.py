from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings
from app.infrastructure.elasticsearch.client import ElasticsearchClient


async def main() -> int:
    settings = get_settings()
    if not settings.elasticsearch_url:
        print("ERROR: ELASTICSEARCH_URL is not configured")
        return 2

    client = ElasticsearchClient(
        settings.elasticsearch_url,
        username=settings.elasticsearch_username,
        password=settings.elasticsearch_password,
        timeout=settings.elasticsearch_timeout,
    )
    try:
        info = await client.info()
        version = str(info.get("version", {}).get("number", "unknown"))
        cluster = str(info.get("cluster_name", "unknown"))
        plugins = await client.plugins()
        nori_versions = [
            str(item.get("version", "unknown"))
            for item in plugins
            if item.get("component") == "analysis-nori" or item.get("name") == "analysis-nori"
        ]
        print(f"elasticsearch=ok version={version} cluster={cluster}")
        print("analysis_nori=" + (",".join(nori_versions) if nori_versions else "missing"))
        print(f"document_alias={settings.es_document_alias}")
        return 0 if nori_versions else 3
    finally:
        await client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
