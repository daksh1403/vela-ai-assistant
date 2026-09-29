import base64
import json
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.main import make_app


@pytest.fixture
def settings():
    return Settings(
        app_env="test", callmissed_api_key="test-only-placeholder", rate_chat_per_minute=2
    )


def client_for(settings, responder):
    app = make_app(settings, transport=httpx.MockTransport(responder))
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_health_and_readiness(settings):
    async with client_for(settings, lambda req: httpx.Response(500)) as client:
        live = await client.get("/api/v1/health/live")
        ready = await client.get("/api/v1/health/ready")
    assert live.status_code == ready.status_code == 200
    assert live.json()["environment"] == "test"
    assert live.headers["x-request-id"]


@pytest.mark.asyncio
async def test_chat_multiturn_and_validation(settings):
    seen = []

    def respond(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "A useful answer"}}]})

    async with client_for(settings, respond) as client:
        response = await client.post(
            "/api/v1/chat",
            json={
                "messages": [
                    {"role": "user", "content": "Hi"},
                    {"role": "assistant", "content": "Hello"},
                    {"role": "user", "content": "Continue"},
                ]
            },
        )
        invalid = await client.post(
            "/api/v1/chat", json={"messages": [{"role": "user", "content": "   "}]}
        )
        malformed = await client.post(
            "/api/v1/chat", content="{bad", headers={"content-type": "application/json"}
        )
    assert response.json()["answer"] == "A useful answer"
    assert len(seen[0]["messages"]) == 3
    assert invalid.status_code == malformed.status_code == 422
    assert invalid.json()["error"]["code"] == "INVALID_INPUT"


@pytest.mark.asyncio
async def test_chat_rate_limit_and_upstream_failure(settings):
    async with client_for(settings, lambda req: httpx.Response(429)) as client:
        body = {"messages": [{"role": "user", "content": "Hi"}]}
        first = await client.post("/api/v1/chat", json=body)
        second = await client.post("/api/v1/chat", json=body)
        third = await client.post("/api/v1/chat", json=body)
    assert first.status_code == second.status_code == 429
    assert first.json()["error"]["code"] == "UPSTREAM_RATE_LIMIT"
    assert third.json()["error"]["code"] == "RATE_LIMITED"


@pytest.mark.asyncio
async def test_streaming_chat(settings):
    payload = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n'
    async with client_for(settings, lambda req: httpx.Response(200, text=payload)) as client:
        response = await client.post(
            "/api/v1/chat/stream", json={"messages": [{"role": "user", "content": "Hi"}]}
        )
    assert response.status_code == 200
    assert '"delta": "Hello"' in response.text
    assert '"done":true' in response.text


@pytest.mark.asyncio
async def test_images_and_malformed_response(settings):
    encoded = base64.b64encode(b"\x89PNG\r\n\x1a\ncontent").decode()
    async with client_for(
        settings, lambda req: httpx.Response(200, json={"data": [{"b64_json": encoded}]})
    ) as client:
        result = await client.post("/api/v1/images", json={"prompt": "A blue vase"})
        bad = await client.post("/api/v1/images", json={"prompt": " "})
    assert result.status_code == 200 and result.json()["mime_type"] == "image/png"
    assert bad.status_code == 422
    async with client_for(settings, lambda req: httpx.Response(200, json={"data": []})) as client:
        broken = await client.post("/api/v1/images", json={"prompt": "A blue vase"})
    assert broken.json()["error"]["code"] == "UPSTREAM_MALFORMED"


@pytest.mark.asyncio
async def test_image_timeout(settings):
    def timeout(_request):
        raise httpx.ReadTimeout("slow")

    async with client_for(settings, timeout) as client:
        result = await client.post("/api/v1/images", json={"prompt": "A blue vase"})
    assert result.status_code == 504
    assert result.json()["error"]["code"] == "UPSTREAM_TIMEOUT"


@pytest.mark.asyncio
async def test_voice_create_end_and_transcript(settings):
    session_id = str(uuid4())
    calls = []

    def respond(request):
        calls.append((request.method, request.url.path))
        if request.method == "POST":
            return httpx.Response(
                201,
                json={
                    "id": session_id,
                    "ws_url": "wss://voice.example.test",
                    "token": "temporary-token",
                },
            )
        if request.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(200, json=[{"user_transcript": "Hi", "agent_response": "Hello"}])

    async with client_for(settings, respond) as client:
        created = await client.post("/api/v1/voice/sessions", json={})
        data = created.json()
        denied = await client.post(
            f"/api/v1/voice/sessions/{session_id}/end", json={"end_token": "x" * 64}
        )
        transcript = await client.post(
            f"/api/v1/voice/sessions/{session_id}/transcript", json={"end_token": data["end_token"]}
        )
        ended = await client.post(
            f"/api/v1/voice/sessions/{session_id}/end", json={"end_token": data["end_token"]}
        )
    assert created.status_code == 200
    assert data["ws_url"] == "wss://voice.example.test"
    assert "test-only-placeholder" not in created.text
    assert denied.status_code == 403
    assert transcript.json()["turns"][0] == {"user": "Hi", "agent": "Hello"}
    assert ended.status_code == 204
    assert calls[0] == ("POST", "/v1/voice/sessions")


@pytest.mark.asyncio
async def test_voice_upstream_failure(settings):
    async with client_for(settings, lambda req: httpx.Response(503)) as client:
        response = await client.post("/api/v1/voice/sessions", json={})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_production_config_fails_closed():
    with pytest.raises(ValidationError):
        Settings(app_env="production", callmissed_api_key="", public_app_url="http://localhost")
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            callmissed_api_key="placeholder",
            public_app_url="https://example.com",
            allowed_origins="*",
        )


@pytest.mark.asyncio
async def test_placeholder_key_is_not_ready():
    settings = Settings(app_env="development", callmissed_api_key="replace-with-rotated-key")
    async with client_for(settings, lambda req: httpx.Response(500)) as client:
        response = await client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "NOT_READY"
