"""Business operations provided by the private text assistant."""

from __future__ import annotations

from typing import Literal

from .client import OrinChatClient
from .errors import EmptyAnswerError
from .models import CompletionResult, GenerationOptions, Message


Operation = Literal["summarize", "rewrite", "extract", "ask"]

INSTRUCTIONS: dict[Operation, str] = {
    "summarize": "Summarize the supplied text accurately and concisely. Do not add facts.",
    "rewrite": "Rewrite the supplied text for clarity and brevity while preserving its meaning.",
    "extract": "Extract key facts, decisions, action items, owners, and dates. Use concise headings. Do not infer missing data.",
    "ask": "Answer the user's request directly. State uncertainty instead of inventing facts.",
}


class TextAssistant:
    def __init__(self, client: OrinChatClient) -> None:
        self._client = client

    def run(
        self,
        operation: Operation,
        text: str,
        *,
        temperature: float = 0.2,
        num_ctx: int = 2048,
        num_predict: int = 512,
        think: bool = False,
    ) -> CompletionResult:
        cleaned = text.strip()
        if not cleaned:
            raise ValueError("Input text cannot be empty")
        messages: list[Message] = [
            {"role": "system", "content": INSTRUCTIONS[operation]},
            {"role": "user", "content": cleaned},
        ]
        result = self._client.chat(
            messages,
            GenerationOptions(
                temperature=temperature,
                num_ctx=num_ctx,
                num_predict=num_predict,
                think=think,
            ),
        )
        if not result.answer.strip():
            reason = result.done_reason or "unknown"
            raise EmptyAnswerError(f"Model returned no final answer (done_reason={reason})")
        return result

