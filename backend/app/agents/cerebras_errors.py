"""Pure error model -> no SDK import so this module is independently unit-testable.

Import nothing from cerebras here. Other modules catch SDK exceptions and pass
them to classify_error() which returns a typed CerebrasError.
"""
import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class CerebrasErrorKind(str, Enum):
    AUTH_LOST = "auth_lost"
    RATE_LIMITED = "rate_limited"
    MODEL_UNSUPPORTED = "model_unsupported"
    GENERIC = "generic"


@dataclass
class CerebrasError(Exception):
    kind: CerebrasErrorKind
    message: str
    retry_after_seconds: Optional[int] = None

    def to_frontend_payload(self) -> dict:
        base = {"kind": self.kind.value, "message": self.message}
        if self.retry_after_seconds is not None:
            base["retry_after_seconds"] = self.retry_after_seconds
        return base


def classify_error(exc: Exception) -> CerebrasError:
    msg = str(exc).lower()
    if "401" in msg or "unauthorized" in msg or ("auth" in msg and "key" in msg):
        return CerebrasError(kind=CerebrasErrorKind.AUTH_LOST, message=str(exc))
    if "rate limit" in msg or "429" in msg or "quota" in msg or "too many" in msg:
        m = re.search(r"retry after (\d+)", msg)
        retry = int(m.group(1)) if m else 90
        return CerebrasError(
            kind=CerebrasErrorKind.RATE_LIMITED,
            message=str(exc),
            retry_after_seconds=retry,
        )
    if "model_not_found" in msg or ("model" in msg and ("not available" in msg or "retired" in msg)):
        return CerebrasError(kind=CerebrasErrorKind.MODEL_UNSUPPORTED, message=str(exc))
    return CerebrasError(kind=CerebrasErrorKind.GENERIC, message=str(exc))
