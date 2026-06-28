from fastapi import APIRouter
from app.agents.cerebras_client import CerebrasClient

router = APIRouter(prefix="/api", tags=["health"])

_client: CerebrasClient | None = None


def _get_client() -> CerebrasClient:
    global _client
    if _client is None:
        _client = CerebrasClient()
    return _client


@router.get("/health")
def health():
    return _get_client().get_health()
