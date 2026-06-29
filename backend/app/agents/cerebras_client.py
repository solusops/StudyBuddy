"""Cerebras SDK wrapper.

Responsibilities:
- structured_complete(): call API with strict JSON schema, parse into a Pydantic model
- stream_complete(): async generator yielding text tokens
- Rate-limit short-circuit: tracks cooldown window, raises CerebrasError immediately
- Health mailbox: get_health() exposes current state for the /api/health endpoint
- Schema builder: strips $defs and enforces additionalProperties=false at all levels

Each method is self-contained. If structured_complete breaks, stream still works.
"""
import json
import os
import time
from typing import Any, AsyncIterator, Dict, List, Optional, Type

from pydantic import BaseModel, ValidationError

from app.agents.cerebras_errors import CerebrasError, CerebrasErrorKind, classify_error

MODEL_ID = "gemma-4-31b"


class CerebrasClient:
    def __init__(self, api_key: Optional[str] = None) -> None:
        from cerebras.cloud.sdk import Cerebras

        self._client = Cerebras(api_key=api_key or os.getenv("CEREBRAS_API_KEY"))
        self._health: dict = {"status": "ok"}
        self._rate_limit_until: float = 0.0

    # ------------------------------------------------------------------ #
    # Health                                                               #
    # ------------------------------------------------------------------ #

    def get_health(self) -> dict:
        return dict(self._health)

    # ------------------------------------------------------------------ #
    # Internal helpers                                                     #
    # ------------------------------------------------------------------ #

    def _check_rate_limit(self) -> None:
        remaining = self._rate_limit_until - time.time()
        if remaining > 0:
            err = CerebrasError(
                kind=CerebrasErrorKind.RATE_LIMITED,
                message=f"Rate limit active for {int(remaining)}s more",
                retry_after_seconds=int(remaining),
            )
            self._health = {"status": "error", **err.to_frontend_payload()}
            raise err

    def _handle_sdk_exc(self, exc: Exception) -> None:
        err = classify_error(exc)
        if err.kind == CerebrasErrorKind.RATE_LIMITED and err.retry_after_seconds:
            self._rate_limit_until = time.time() + err.retry_after_seconds
        self._health = {"status": "error", **err.to_frontend_payload()}
        raise err from exc

    def _build_schema(self, model: Type[BaseModel]) -> Dict[str, Any]:
        raw = model.model_json_schema()
        defs = raw.pop("$defs", {})

        def _inline(obj: Any) -> Any:
            """Recursively replace every {"$ref": "#/$defs/Name"} with a copy of
            the referenced definition. Cerebras strict mode rejects $ref, so the
            schema must be fully self-contained."""
            if isinstance(obj, list):
                return [_inline(v) for v in obj]
            if not isinstance(obj, dict):
                return obj
            ref = obj.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/$defs/"):
                target = defs.get(ref.split("/")[-1], {})
                merged = {**target, **{k: v for k, v in obj.items() if k != "$ref"}}
                return _inline(merged)
            return {k: _inline(v) for k, v in obj.items()}

        raw = _inline(raw)
        raw["additionalProperties"] = False

        def _fix(obj: Any) -> None:
            if not isinstance(obj, dict):
                return
            if obj.get("type") == "object":
                obj.setdefault("additionalProperties", False)
            for v in obj.values():
                if isinstance(v, list):
                    for item in v:
                        _fix(item)
                else:
                    _fix(v)

        _fix(raw)
        return raw

    # ------------------------------------------------------------------ #
    # Public API                                                           #
    # ------------------------------------------------------------------ #

    def structured_complete(
        self, messages: List[Dict[str, Any]], output_model: Type[BaseModel], model: str | None = None
    ) -> BaseModel:
        self._check_rate_limit()
        schema = self._build_schema(output_model)
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": output_model.__name__,
                "strict": True,
                "schema": schema,
            },
        }
        try:
            resp = self._client.chat.completions.create(
                model=model or MODEL_ID, messages=messages, response_format=response_format
            )
            raw = resp.choices[0].message.content
            self._health = {"status": "ok"}
            return output_model.model_validate_json(raw)
        except CerebrasError:
            raise
        except (json.JSONDecodeError, ValidationError):
            # One retry on parse failure or truncated JSON (EOF validation error)
            resp = self._client.chat.completions.create(
                model=model or MODEL_ID, messages=messages, response_format=response_format
            )
            return output_model.model_validate_json(resp.choices[0].message.content)
        except Exception as exc:
            self._handle_sdk_exc(exc)

    async def stream_complete(self, messages: List[Dict[str, Any]], model: str | None = None) -> AsyncIterator[str]:
        self._check_rate_limit()
        try:
            stream = self._client.chat.completions.create(
                model=model or MODEL_ID, messages=messages, stream=True
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta
            self._health = {"status": "ok"}
        except CerebrasError:
            raise
        except Exception as exc:
            self._handle_sdk_exc(exc)
