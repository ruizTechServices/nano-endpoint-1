"""Request validation and local rate limiting."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable
from typing import Any


MAX_BODY_BYTES = 8_192


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

