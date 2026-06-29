import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.agents.cerebras_client import CerebrasClient

router = APIRouter(prefix="/api", tags=["health"])

_client: CerebrasClient | None = None

# All keys the frontend can configure
_KEY_NAMES = ["CEREBRAS_API_KEY", "TAVILY_API_KEY", "YOUTUBE_API_KEY"]
_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def _get_client() -> CerebrasClient:
    global _client
    if _client is None:
        _client = CerebrasClient()
    return _client


@router.get("/health")
def health():
    return _get_client().get_health()


@router.get("/keys")
def get_keys():
    """Return which API keys are currently set (never exposes actual values)."""
    return {k: bool(os.getenv(k, "")) for k in _KEY_NAMES}


class SaveKeysRequest(BaseModel):
    CEREBRAS_API_KEY: Optional[str] = None
    TAVILY_API_KEY: Optional[str] = None
    YOUTUBE_API_KEY: Optional[str] = None


@router.post("/keys")
def save_keys(req: SaveKeysRequest):
    """Persist non-empty keys to backend/.env and hot-reload into os.environ."""
    incoming = {k: v for k, v in req.model_dump().items() if v}
    if not incoming:
        return {"saved": 0}

    # Read existing .env lines (preserve keys the user didn't touch)
    existing: dict[str, str] = {}
    if _ENV_PATH.exists():
        for line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                existing[k.strip()] = v.strip()

    # Merge: new values overwrite existing; keep anything else
    existing.update(incoming)

    # Write back
    _ENV_PATH.write_text(
        "\n".join(f"{k}={v}" for k, v in existing.items()) + "\n",
        encoding="utf-8",
    )

    # Hot-reload into the running process so the next LLM call uses the new key
    for k, v in incoming.items():
        os.environ[k] = v

    # Reset the cached Cerebras client so it picks up a new API key
    global _client
    _client = None

    return {"saved": len(incoming)}

