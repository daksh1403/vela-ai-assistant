import asyncio
import base64
import binascii
import json
import logging
import time
from collections.abc import AsyncGenerator
from typing import Any, Literal
from uuid import UUID

import httpx

from .config import Settings
from .errors import ProviderError, map_upstream_status
from .metrics import AI_LATENCY, AI_REQUESTS
from .models import ChatMessage, ImageResponse, VoiceSessionResponse

logger = logging.getLogger("vela.provider")


class CallMissedService:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.client = httpx.AsyncClient(
            base_url=settings.callmissed_base_url.rstrip("/") + "/",
            headers={"Authorization": f"Bearer {settings.callmissed_api_key}"},
            transport=transport,
            follow_redirects=False,
            http2=False,
            limits=httpx.Limits(max_connections=settings.upstream_concurrency),
        )
        self.semaphore = asyncio.Semaphore(settings.upstream_concurrency)

    async def close(self) -> None:
        await self.client.aclose()

    async def _acquire(self) -> None:
        try:
            await asyncio.wait_for(self.semaphore.acquire(), timeout=2)
        except TimeoutError as exc:
            raise ProviderError(
                503, "SERVICE_BUSY", "The service is busy. Try again shortly."
            ) from exc

    async def _request(
        self, operation: str, method: str, path: str, **kwargs: Any
    ) -> httpx.Response:
        await self._acquire()
        started = time.monotonic()
        outcome = "success"
        try:
            response = await self.client.request(method, path, **kwargs)
            if response.status_code >= 400:
                outcome = "upstream_error"
                raise map_upstream_status(response.status_code)
            return response
        except httpx.TimeoutException as exc:
            outcome = "timeout"
            raise ProviderError(
                504, "UPSTREAM_TIMEOUT", "The AI service took too long to respond."
            ) from exc
        except httpx.RequestError as exc:
            outcome = "network_error"
            raise ProviderError(
                503, "UPSTREAM_UNAVAILABLE", "AI service is temporarily unavailable."
            ) from exc
        finally:
            self.semaphore.release()
            duration = time.monotonic() - started
            AI_REQUESTS.labels(operation, outcome).inc()
            AI_LATENCY.labels(operation).observe(duration)
            logger.info(
                "provider_request",
                extra={
                    "operation": operation,
                    "result": outcome,
                    "duration_ms": round(duration * 1000),
                },
            )

    async def chat(self, messages: list[ChatMessage]) -> str:
        response = await self._request(
            "chat",
            "POST",
            "chat/completions",
            json={
                "model": self.settings.chat_model,
                "messages": [m.model_dump() for m in messages],
                "stream": False,
                "max_tokens": 1200,
            },
            timeout=httpx.Timeout(self.settings.request_timeout_seconds, connect=5),
        )
        try:
            content = response.json()["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise ValueError("empty content")
            return content
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderError(
                502, "UPSTREAM_MALFORMED", "The AI service returned an invalid response."
            ) from exc

    async def image(self, prompt: str) -> ImageResponse:
        response = await self._request(
            "image",
            "POST",
            "images/generations",
            json={
                "model": self.settings.image_model,
                "prompt": prompt,
                "n": 1,
                "size": "1024x1024",
                "response_format": "b64_json",
            },
            timeout=httpx.Timeout(self.settings.image_timeout_seconds, connect=5),
        )
        try:
            encoded = response.json()["data"][0]["b64_json"]
            if not isinstance(encoded, str) or len(encoded) > 28_000_000:
                raise ValueError("invalid image size")
            raw = base64.b64decode(encoded, validate=True)
            if raw.startswith(b"\x89PNG\r\n\x1a\n"):
                mime: Literal["image/png", "image/jpeg", "image/webp"] = "image/png"
            elif raw.startswith(b"\xff\xd8\xff"):
                mime = "image/jpeg"
            elif raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
                mime = "image/webp"
            else:
                raise ValueError("invalid image type")
            return ImageResponse(image=encoded, mime_type=mime)
        except (ValueError, KeyError, IndexError, TypeError, binascii.Error) as exc:
            raise ProviderError(
                502, "UPSTREAM_MALFORMED", "The AI service returned an invalid image."
            ) from exc

    async def create_voice(self, end_token: str) -> VoiceSessionResponse:
        response = await self._request(
            "voice_create",
            "POST",
            "voice/sessions",
            json={
                "system_prompt": "You are Vela. Speak naturally and keep responses brief.",
                "greeting": "Hello, I'm Vela. What would you like to explore?",
                "voice": self.settings.voice_name,
                "language": self.settings.voice_language,
                "max_duration_seconds": self.settings.voice_max_duration_seconds,
            },
            timeout=httpx.Timeout(self.settings.request_timeout_seconds, connect=5),
        )
        try:
            data = response.json()
            if not isinstance(data["ws_url"], str) or not data["ws_url"].startswith("wss://"):
                raise ValueError("invalid ws url")
            if not isinstance(data["token"], str) or not data["token"]:
                raise ValueError("invalid token")
            return VoiceSessionResponse(
                id=UUID(data["id"]),
                ws_url=data["ws_url"],
                token=data["token"],
                end_token=end_token,
                max_duration_seconds=self.settings.voice_max_duration_seconds,
            )
        except (ValueError, KeyError, TypeError) as exc:
            raise ProviderError(
                502, "UPSTREAM_MALFORMED", "The AI service returned an invalid voice session."
            ) from exc

    async def end_voice(self, session_id: UUID) -> None:
        await self._request(
            "voice_end",
            "DELETE",
            f"voice/sessions/{session_id}",
            timeout=httpx.Timeout(10, connect=5),
        )

    async def voice_transcript(self, session_id: UUID) -> list[dict[str, str]]:
        response = await self._request(
            "voice_transcript",
            "GET",
            f"voice/sessions/{session_id}/transcript",
            params={"format": "json"},
            timeout=httpx.Timeout(10, connect=5),
        )
        try:
            data = response.json()
            if not isinstance(data, list):
                raise ValueError("invalid transcript")
            return [
                {"user": row.get("user_transcript") or "", "agent": row.get("agent_response") or ""}
                for row in data
                if isinstance(row, dict)
            ][:100]
        except ValueError as exc:
            raise ProviderError(
                502, "UPSTREAM_MALFORMED", "The AI service returned an invalid transcript."
            ) from exc

    async def stream_chat(self, messages: list[ChatMessage]) -> AsyncGenerator[str, None]:
        await self._acquire()
        started = time.monotonic()
        outcome = "success"
        response: httpx.Response | None = None
        try:
            request = self.client.build_request(
                "POST",
                "chat/completions",
                json={
                    "model": self.settings.chat_model,
                    "messages": [m.model_dump() for m in messages],
                    "stream": True,
                    "max_tokens": 1200,
                },
                timeout=httpx.Timeout(self.settings.request_timeout_seconds, connect=5),
            )
            response = await self.client.send(request, stream=True)
            if response.status_code >= 400:
                outcome = "upstream_error"
                raise map_upstream_status(response.status_code)
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload == "[DONE]":
                    break
                try:
                    data = json.loads(payload)
                    if "error" in data:
                        outcome = "upstream_error"
                        yield json.dumps({"error": "The AI service stopped responding."}) + "\n"
                        return
                    delta = data["choices"][0]["delta"].get("content")
                    if isinstance(delta, str) and delta:
                        yield json.dumps({"delta": delta}) + "\n"
                except (ValueError, KeyError, IndexError, TypeError):
                    continue
            yield '{"done":true}\n'
        except (httpx.TimeoutException, httpx.RequestError) as exc:
            outcome = "network_error"
            if response is None:
                raise ProviderError(
                    503, "UPSTREAM_UNAVAILABLE", "AI service is temporarily unavailable."
                ) from exc
            yield json.dumps({"error": "The AI service connection was interrupted."}) + "\n"
        finally:
            if response is not None:
                await response.aclose()
            self.semaphore.release()
            duration = time.monotonic() - started
            AI_REQUESTS.labels("chat_stream", outcome).inc()
            AI_LATENCY.labels("chat_stream").observe(duration)
            logger.info(
                "provider_request",
                extra={
                    "operation": "chat_stream",
                    "result": outcome,
                    "duration_ms": round(duration * 1000),
                },
            )
