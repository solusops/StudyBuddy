from app.agents.cerebras_errors import CerebrasErrorKind, CerebrasError, classify_error


def test_rate_limit_classification():
    exc = Exception("Rate limit exceeded. Retry after 60 seconds.")
    err = classify_error(exc)
    assert err.kind == CerebrasErrorKind.RATE_LIMITED
    assert err.retry_after_seconds == 60


def test_model_unsupported_classification():
    exc = Exception("model_not_found: gemma-4-31b is not available")
    err = classify_error(exc)
    assert err.kind == CerebrasErrorKind.MODEL_UNSUPPORTED


def test_generic_classification():
    exc = ValueError("something unexpected")
    err = classify_error(exc)
    assert err.kind == CerebrasErrorKind.GENERIC


def test_auth_classification():
    exc = Exception("401 unauthorized: invalid auth key")
    err = classify_error(exc)
    assert err.kind == CerebrasErrorKind.AUTH_LOST


def test_friendly_payload():
    err = CerebrasError(
        kind=CerebrasErrorKind.RATE_LIMITED, message="slow down", retry_after_seconds=30
    )
    payload = err.to_frontend_payload()
    assert payload["kind"] == "rate_limited"
    assert payload["retry_after_seconds"] == 30
