from unittest.mock import MagicMock, patch
from pydantic import BaseModel
from app.agents.cerebras_client import CerebrasClient
from app.agents.cerebras_errors import CerebrasErrorKind, CerebrasError


class FakeOutput(BaseModel):
    answer: str
    confidence: int


def _make_mock_response(content: str):
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp


def test_structured_complete_parses_json():
    client = CerebrasClient.__new__(CerebrasClient)
    client._health = {"status": "ok"}
    client._rate_limit_until = 0.0
    mock_sdk = MagicMock()
    client._client = mock_sdk
    mock_sdk.chat.completions.create.return_value = _make_mock_response(
        '{"answer": "entropy is disorder", "confidence": 90}'
    )
    result = client.structured_complete(
        [{"role": "user", "content": "define entropy"}], FakeOutput
    )
    assert isinstance(result, FakeOutput)
    assert result.confidence == 90


def test_schema_strips_defs_and_sets_additional_properties():
    client = CerebrasClient.__new__(CerebrasClient)
    client._health = {"status": "ok"}
    client._rate_limit_until = 0.0
    client._client = MagicMock()

    class Nested(BaseModel):
        value: int

    class Outer(BaseModel):
        nested: Nested

    schema = client._build_schema(Outer)
    assert "$defs" not in schema
    assert schema["additionalProperties"] is False


def test_rate_limit_short_circuit():
    import time
    client = CerebrasClient.__new__(CerebrasClient)
    client._health = {"status": "ok"}
    client._rate_limit_until = time.time() + 60
    client._client = MagicMock()

    try:
        client.structured_complete([{"role": "user", "content": "test"}], FakeOutput)
        assert False, "Should have raised CerebrasError"
    except CerebrasError as err:
        assert err.kind == CerebrasErrorKind.RATE_LIMITED


def test_complete_with_tools_returns_message_with_tool_calls():
    client = CerebrasClient.__new__(CerebrasClient)
    client._health = {"status": "ok"}
    client._rate_limit_until = 0.0
    mock_sdk = MagicMock()
    client._client = mock_sdk

    tool_call = MagicMock()
    tool_call.id = "call_1"
    tool_call.function.name = "web_search"
    tool_call.function.arguments = '{"query": "VAE"}'
    message = MagicMock()
    message.tool_calls = [tool_call]
    message.content = ""
    resp = MagicMock()
    resp.choices = [MagicMock(message=message)]
    mock_sdk.chat.completions.create.return_value = resp

    tools = [{"type": "function", "function": {"name": "web_search", "parameters": {}}}]
    result = client.complete_with_tools([{"role": "user", "content": "what is a VAE"}], tools)

    assert result.tool_calls[0].function.name == "web_search"
    # tools + tool_choice forwarded to the SDK
    _, kwargs = mock_sdk.chat.completions.create.call_args
    assert kwargs["tools"] == tools
    assert kwargs["tool_choice"] == "auto"


def test_complete_with_tools_passes_through_no_tool_answer():
    client = CerebrasClient.__new__(CerebrasClient)
    client._health = {"status": "ok"}
    client._rate_limit_until = 0.0
    mock_sdk = MagicMock()
    client._client = mock_sdk

    message = MagicMock()
    message.tool_calls = None
    message.content = "A VAE is a generative model."
    resp = MagicMock()
    resp.choices = [MagicMock(message=message)]
    mock_sdk.chat.completions.create.return_value = resp

    result = client.complete_with_tools([{"role": "user", "content": "vae?"}], [])
    assert result.tool_calls is None
    assert "generative model" in result.content
