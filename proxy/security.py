"""Request validation and local rate limiting."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable
from typing import Any


MAX_BODY_BYTES = 8_192

# The save route carries a whole conversation snapshot, so it needs a far larger ceiling.
MAX_SAVE_BODY_BYTES = 2 * 1024 * 1024
MAX_SAVE_TURNS = 5_000
MAX_SAVE_SUMMARIES = 5_000
MAX_SAVE_TEXT_CHARS = 100_000
MAX_SAVE_ID_CHARS = 64
MAX_SAVE_TS_CHARS = 64


class ValidationError(Exception):
    """A client-safe validation failure."""


def validate_search_payload(payload: Any) -> tuple[str, int]:
    if not isinstance(payload, dict):
        raise ValidationError("Request body must be a JSON object")
    unexpected = set(payload) - {"query", "count"}
    if unexpected:
        raise ValidationError("Request contains unsupported fields")
    query = payload.get("query")
    if not isinstance(query, str):
        raise ValidationError("Search query must be a string")
    query = query.strip()
    if len(query) < 2 or len(query) > 400 or any(ord(character) < 32 for character in query):
        raise ValidationError("Search query must contain 2 to 400 printable characters")
    count = payload.get("count", 5)
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 10:
        raise ValidationError("Search result count must be an integer from 1 to 10")
    return query, count


def _require_text(value: Any, field: str, *, max_chars: int, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a string")
    if len(value) > max_chars:
        raise ValidationError(f"{field} exceeds the maximum length")
    if not allow_empty and not value.strip():
        raise ValidationError(f"{field} must not be empty")
    return value


def _require_non_negative_int(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValidationError(f"{field} must be a non-negative integer")
    return value


def _optional_ts(value: Any, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > MAX_SAVE_TS_CHARS:
        raise ValidationError(f"{field} must be a short timestamp string or null")
    return value


def _validate_turn(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValidationError("Each turn must be a JSON object")
    if set(item) - {"id", "position", "user", "assistant", "thinking", "ts"}:
        raise ValidationError("A turn contains unsupported fields")
    return {
        "id": _require_text(item.get("id"), "turn id", max_chars=MAX_SAVE_ID_CHARS),
        "position": _require_non_negative_int(item.get("position"), "turn position"),
        "user": _require_text(item.get("user"), "turn user text", max_chars=MAX_SAVE_TEXT_CHARS),
        "assistant": _require_text(item.get("assistant"), "turn assistant text", max_chars=MAX_SAVE_TEXT_CHARS),
        "thinking": _require_text(
            item.get("thinking", ""), "turn thinking", max_chars=MAX_SAVE_TEXT_CHARS, allow_empty=True
        ),
        "ts": _optional_ts(item.get("ts"), "turn ts"),
    }


def _validate_summary(item: Any, default_conversation_id: int) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValidationError("Each summary must be a JSON object")
    if set(item) - {"id", "conversationId", "position", "summary", "ts"}:
        raise ValidationError("A summary contains unsupported fields")
    return {
        "id": _require_text(item.get("id"), "summary id", max_chars=MAX_SAVE_ID_CHARS),
        "conversation_id": _require_non_negative_int(
            item.get("conversationId", default_conversation_id), "summary conversationId"
        ),
        "position": _require_non_negative_int(item.get("position"), "summary position"),
        "summary": _require_text(item.get("summary"), "summary text", max_chars=MAX_SAVE_TEXT_CHARS),
        "ts": _optional_ts(item.get("ts"), "summary ts"),
    }


def validate_save_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("Request body must be a JSON object")
    if set(payload) - {"conversationId", "turns", "summaries"}:
        raise ValidationError("Request contains unsupported fields")
    conversation_id = _require_non_negative_int(payload.get("conversationId"), "conversationId")

    turns_raw = payload.get("turns", [])
    summaries_raw = payload.get("summaries", [])
    if not isinstance(turns_raw, list) or not isinstance(summaries_raw, list):
        raise ValidationError("turns and summaries must be arrays")
    if len(turns_raw) > MAX_SAVE_TURNS:
        raise ValidationError("Too many turns in a single save")
    if len(summaries_raw) > MAX_SAVE_SUMMARIES:
        raise ValidationError("Too many summaries in a single save")
    if not turns_raw and not summaries_raw:
        raise ValidationError("There is nothing to save")

    return {
        "conversation_id": conversation_id,
        "turns": [_validate_turn(item) for item in turns_raw],
        "summaries": [_validate_summary(item, conversation_id) for item in summaries_raw],
    }


class RateLimiter:
    def __init__(
        self,
        *,
        requests: int = 30,
        window_seconds: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._requests = requests
        self._window_seconds = window_seconds
        self._clock = clock
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, client: str) -> bool:
        now = self._clock()
        cutoff = now - self._window_seconds
        with self._lock:
            events = self._events[client]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= self._requests:
                return False
            events.append(now)
            return True

