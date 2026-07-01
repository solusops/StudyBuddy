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
import threading
from typing import Any, AsyncIterator, Dict, List, Optional, Type

from pydantic import BaseModel, ValidationError

from app.agents.cerebras_errors import CerebrasError, CerebrasErrorKind, classify_error

MODEL_ID = "gemma-4-31b"
_deployment_env = os.getenv("DEPLOYMENT_ENV", "desktop")
_cerebras_concurrency = 5 if _deployment_env == "demo" else 50
_cerebras_semaphore = threading.Semaphore(_cerebras_concurrency)


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

    async def _async_check_rate_limit(self) -> None:
        remaining = self._rate_limit_until - time.time()
        if remaining > 0:
            print(f"[Cerebras] Waiting {remaining:.1f}s for rate limit cooldown...")
            import asyncio
            await asyncio.sleep(remaining)

    def _sync_check_rate_limit(self) -> None:
        remaining = self._rate_limit_until - time.time()
        if remaining > 0:
            print(f"[Cerebras] Waiting {remaining:.1f}s for rate limit cooldown...")
            time.sleep(remaining)

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
        self, messages: List[Dict[str, Any]], output_model: Type[BaseModel], model: str | None = None, **kwargs
    ) -> BaseModel:
        from cerebras.cloud.sdk import APIConnectionError as _ConnErr

        self._sync_check_rate_limit()
        schema = self._build_schema(output_model)
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": output_model.__name__,
                "strict": True,
                "schema": schema,
            },
        }
        last_exc: Exception = RuntimeError("unreachable")
        max_retries = 3
        for attempt in range(max_retries):
            self._sync_check_rate_limit()
            try:
                t0 = time.time()
                with _cerebras_semaphore:
                    resp = self._client.chat.completions.create(
                        model=model or MODEL_ID, messages=messages, response_format=response_format, **kwargs
                    )
                t1 = time.time()
                tokens = getattr(resp.usage, "completion_tokens", 0)
                if tokens and (t1 - t0) > 0:
                    suffix = " (retry)" if attempt > 0 else ""
                    print(f"[Cerebras Speed] structured_complete{suffix} generated {tokens} tokens in {t1-t0:.2f}s ({tokens/(t1-t0):.1f} tok/s)")
                raw = resp.choices[0].message.content
                self._health = {"status": "ok"}
                return output_model.model_validate_json(raw)
            except _ConnErr as exc:
                # HTTP/2 server disconnect — retry once with backoff
                last_exc = exc
                time.sleep(2)
                continue
            except Exception as exc:
                err = classify_error(exc)
                if err.kind == CerebrasErrorKind.RATE_LIMITED and attempt < max_retries - 1:
                    delay = err.retry_after_seconds or (2 ** attempt)
                    print(f"[Cerebras] Rate limited. Retrying structured_complete in {delay}s...")
                    self._rate_limit_until = time.time() + delay
                    last_exc = exc
                    continue
                
                if isinstance(exc, (json.JSONDecodeError, ValidationError)):
                    last_exc = exc
                    if attempt == 0:
                        continue
                self._handle_sdk_exc(exc)
        self._handle_sdk_exc(last_exc)

    def complete_with_tools(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        tool_choice: str = "auto",
        model: str | None = None,
        **kwargs
    ):
        """Non-streaming completion that may return tool calls.

        Returns the raw SDK message object (has `.content` and `.tool_calls`).
        The caller inspects `.tool_calls`, executes them, appends the results,
        then streams the final answer via stream_complete().
        """
        max_retries = 3
        last_exc: Exception = RuntimeError("unreachable")
        for attempt in range(max_retries):
            self._sync_check_rate_limit()
            try:
                t0 = time.time()
                with _cerebras_semaphore:
                    resp = self._client.chat.completions.create(
                        model=model or MODEL_ID,
                        messages=messages,
                        tools=tools,
                        tool_choice=tool_choice,
                        **kwargs
                    )
                t1 = time.time()
                tokens = getattr(resp.usage, "completion_tokens", 0)
                if tokens and (t1 - t0) > 0:
                    print(f"[Cerebras Speed] complete_with_tools generated {tokens} tokens in {t1-t0:.2f}s ({tokens/(t1-t0):.1f} tok/s)")
                    
                self._health = {"status": "ok"}
                return resp.choices[0].message
            except Exception as exc:
                err = classify_error(exc)
                if err.kind == CerebrasErrorKind.RATE_LIMITED and attempt < max_retries - 1:
                    delay = err.retry_after_seconds or (2 ** attempt)
                    print(f"[Cerebras] Rate limited. Retrying complete_with_tools in {delay}s...")
                    self._rate_limit_until = time.time() + delay
                    last_exc = exc
                    continue
                self._handle_sdk_exc(exc)
        self._handle_sdk_exc(last_exc)

    async def stream_complete(self, messages: List[Dict[str, Any]], model: str | None = None, **kwargs) -> AsyncIterator[str]:
        max_retries = 3
        last_exc: Exception = RuntimeError("unreachable")
        for attempt in range(max_retries):
            await self._async_check_rate_limit()
            try:
                t0 = time.time()
                with _cerebras_semaphore:
                    # Note: this blocks the thread during generator creation.
                    # We only hold the semaphore for the initial call, the streaming
                    # generator yields responses over time. But wait, if stream is sync,
                    # the generator yields in real-time. Since we process chunks outside the
                    # semaphore, we don't hold the semaphore while yielding.
                    stream = self._client.chat.completions.create(
                        model=model or MODEL_ID, messages=messages, stream=True, **kwargs
                    )
                chunk_count = 0
                usage_logged = False
                for chunk in stream:
                    usage = getattr(chunk, "usage", None)
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta:
                        chunk_count += 1
                        yield delta
                    if usage and getattr(usage, "completion_tokens", 0) and not usage_logged:
                        t1 = time.time()
                        tokens = usage.completion_tokens
                        if tokens and (t1 - t0) > 0:
                            print(f"[Cerebras Speed] stream_complete generated {tokens} tokens in {t1-t0:.2f}s ({tokens/(t1-t0):.1f} tok/s)")
                            usage_logged = True
                            
                if not usage_logged:
                    t1 = time.time()
                    if (t1 - t0) > 0 and chunk_count > 0:
                        print(f"[Cerebras Speed] stream_complete (approx) generated {chunk_count} chunks in {t1-t0:.2f}s ({chunk_count/(t1-t0):.1f} chunks/s)")

                self._health = {"status": "ok"}
                return
            except Exception as exc:
                err = classify_error(exc)
                if err.kind == CerebrasErrorKind.RATE_LIMITED and attempt < max_retries - 1:
                    delay = err.retry_after_seconds or (2 ** attempt)
                    print(f"[Cerebras] Rate limited. Retrying stream_complete in {delay}s...")
                    self._rate_limit_until = time.time() + delay
                    last_exc = exc
                    continue
                self._handle_sdk_exc(exc)
        self._handle_sdk_exc(last_exc)
