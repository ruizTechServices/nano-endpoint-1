"""Typed request and response models for the documented contract."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypedDict


Role = Literal["system", "user", "assistant"]


class Message(TypedDict):
    role: Role
    content: str


@dataclass(frozen=True, slots=True)
class GenerationOptions:
    temperature: float = 0.2
    num_ctx: int = 2048
    num_predict: int = 512
    think: bool = False
    keep_alive: str = "10m"

    def validate(self) -> None:
        if not 0 <= self.temperature <= 2:
            raise ValueError("temperature must be between 0 and 2")
        if self.num_ctx < 1 or self.num_predict < 1:
            raise ValueError("token limits must be positive")
        if self.think and self.num_predict < 1024:
            raise ValueError("thinking mode requires num_predict >= 1024")


@dataclass(frozen=True, slots=True)
class CompletionResult:
    answer: str
    thinking: str
    model: str
    done: bool
    done_reason: str | None
    generated_tokens: int | None
    latency_ms: float
    request_id: str

