from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)

    @field_validator("content")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Message cannot be blank")
        return value


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def validate_turns(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("The last message must be from the user")
        if sum(len(message.content) for message in self.messages) > 30000:
            raise ValueError("Conversation is too long")
        return self


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)

    @field_validator("prompt")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Prompt cannot be blank")
        return value.strip()


class ImageResponse(BaseModel):
    image: str
    mime_type: Literal["image/png", "image/jpeg", "image/webp"]


class VoiceSessionResponse(BaseModel):
    id: UUID
    ws_url: str
    token: str
    end_token: str
    max_duration_seconds: int


class VoiceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EndVoiceRequest(BaseModel):
    end_token: str = Field(min_length=32, max_length=128)


class HealthResponse(BaseModel):
    status: str
    service: str = "vela-api"
    version: str
    environment: str
