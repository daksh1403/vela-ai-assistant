import hmac
import json
import logging
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from hashlib import sha256
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from .config import Settings, get_settings
from .errors import AppError
from .metrics import HTTP_LATENCY, HTTP_REQUESTS
from .models import (
    ChatRequest,
    EndVoiceRequest,
    HealthResponse,
    ImageRequest,
    ImageResponse,
    VoiceCreateRequest,
    VoiceSessionResponse,
)
from .provider import CallMissedService
from .ratelimit import RateLimiter

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "severity": record.levelname,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        for field in (
            "method",
            "route",
            "status",
            "latency_ms",
            "operation",
            "result",
            "duration_ms",
        ):
            if hasattr(record, field):
                data[field] = getattr(record, field)
        return json.dumps(data, separators=(",", ":"))


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    logging.getLogger("httpx").setLevel(logging.WARNING)


def make_app(settings: Settings | None = None, transport=None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    provider = CallMissedService(settings, transport=transport)
    limiter = RateLimiter()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if settings.app_env == "production" and not settings.callmissed_api_key:
            raise RuntimeError("Missing provider key")
        yield
        await provider.close()

    app = FastAPI(
        title="Vela API",
        version=settings.app_version,
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.app_env != "production" else None,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        supplied = request.headers.get("x-request-id", "")
        request_id = (
            supplied
            if len(supplied) <= 64 and supplied.isascii() and supplied.isalnum()
            else secrets.token_hex(12)
        )
        token = request_id_var.set(request_id)
        request.state.request_id = request_id
        started = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            logging.getLogger("vela.api").exception("unhandled_request_error")
            response = JSONResponse(
                status_code=500,
                content={
                    "error": {
                        "code": "INTERNAL_ERROR",
                        "message": "An unexpected error occurred.",
                        "request_id": request_id,
                    }
                },
            )
        route = request.scope.get("route")
        route_name = route.path if route else "unmatched"
        elapsed = time.monotonic() - started
        HTTP_REQUESTS.labels(route_name, request.method, str(response.status_code)).inc()
        HTTP_LATENCY.labels(route_name, request.method).observe(elapsed)
        response.headers["X-Request-ID"] = request_id
        response.headers["Cache-Control"] = (
            "no-store" if route_name.startswith("/api/") else "no-cache"
        )
        logging.getLogger("vela.api").info(
            "http_request",
            extra={
                "method": request.method,
                "route": route_name,
                "status": response.status_code,
                "latency_ms": round(elapsed * 1000),
            },
        )
        request_id_var.reset(token)
        return response

    @app.exception_handler(AppError)
    async def app_error(_request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "request_id": request_id_var.get(),
                }
            },
        )

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": "HTTP_ERROR",
                    "message": "The request could not be completed.",
                    "request_id": request_id_var.get(),
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "INVALID_INPUT",
                    "message": "Check the supplied fields and try again.",
                    "request_id": request_id_var.get(),
                }
            },
        )

    async def json_request(request: Request):
        content_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
        if content_type != "application/json":
            raise AppError(
                415, "UNSUPPORTED_MEDIA_TYPE", "Send JSON with Content-Type: application/json."
            )
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > 40_000):
            raise AppError(413, "REQUEST_TOO_LARGE", "The request is too large.")

    def client_ip(request: Request) -> str:
        # Caddy overwrites this header from the actual peer. Direct API access is private.
        return (
            request.headers.get(
                "x-forwarded-for", request.client.host if request.client else "unknown"
            )
            .split(",")[0]
            .strip()
        )

    async def cost_limit(request: Request, operation: str, limit: int) -> None:
        await limiter.check(client_ip(request), operation, limit)

    @app.get("/api/v1/health/live", response_model=HealthResponse)
    async def live():
        return HealthResponse(
            status="ok", version=settings.app_version, environment=settings.app_env
        )

    @app.get("/api/v1/health/ready", response_model=HealthResponse)
    async def ready():
        if (
            not settings.callmissed_api_key or settings.callmissed_api_key.startswith("replace-")
        ) and settings.app_env != "test":
            raise AppError(503, "NOT_READY", "AI service is not configured.")
        return HealthResponse(
            status="ok", version=settings.app_version, environment=settings.app_env
        )

    @app.get("/internal/metrics")
    async def metrics():
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    json_dependency = Depends(json_request)

    @app.post("/api/v1/chat")
    async def chat(body: ChatRequest, request: Request, _json=json_dependency):
        await cost_limit(request, "chat", settings.rate_chat_per_minute)
        answer = await provider.chat(body.messages)
        return {"answer": answer}

    @app.post("/api/v1/chat/stream")
    async def chat_stream(body: ChatRequest, request: Request, _json=json_dependency):
        await cost_limit(request, "chat", settings.rate_chat_per_minute)
        iterator = provider.stream_chat(body.messages)
        try:
            first = await anext(iterator)
        except StopAsyncIteration as exc:
            raise AppError(
                502, "UPSTREAM_MALFORMED", "The AI service returned an empty response."
            ) from exc

        async def output() -> AsyncIterator[str]:
            stream_token = request_id_var.set(request.state.request_id)
            try:
                yield first
                async for chunk in iterator:
                    if await request.is_disconnected():
                        break
                    yield chunk
            finally:
                await iterator.aclose()
                request_id_var.reset(stream_token)

        return StreamingResponse(
            output(), media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"}
        )

    @app.post("/api/v1/images", response_model=ImageResponse)
    async def image(body: ImageRequest, request: Request, _json=json_dependency):
        await cost_limit(request, "image", settings.rate_image_per_minute)
        return await provider.image(body.prompt)

    def end_signature(session_id: UUID) -> str:
        return hmac.new(
            settings.callmissed_api_key.encode(), str(session_id).encode(), sha256
        ).hexdigest()

    @app.post("/api/v1/voice/sessions", response_model=VoiceSessionResponse)
    async def create_voice(request: Request, body: VoiceCreateRequest, _json=json_dependency):
        await cost_limit(request, "voice", settings.rate_voice_per_minute)
        # Signature is computed after receiving the provider's UUID.
        session = await provider.create_voice("")
        session.end_token = end_signature(session.id)
        return session

    @app.post("/api/v1/voice/sessions/{session_id}/end", status_code=204)
    async def end_voice(session_id: UUID, body: EndVoiceRequest, _json=json_dependency):
        if not hmac.compare_digest(body.end_token, end_signature(session_id)):
            raise AppError(403, "INVALID_SESSION", "This voice session cannot be ended here.")
        await provider.end_voice(session_id)
        return Response(status_code=204)

    @app.post("/api/v1/voice/sessions/{session_id}/transcript")
    async def transcript(session_id: UUID, body: EndVoiceRequest, _json=json_dependency):
        if not hmac.compare_digest(body.end_token, end_signature(session_id)):
            raise AppError(403, "INVALID_SESSION", "This transcript is unavailable.")
        return {"turns": await provider.voice_transcript(session_id)}

    return app


app = make_app()
