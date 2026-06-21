"""Resilient client for the documented Ollama chat endpoint."""

from __future__ import annotations

import json
import logging
import random
import socket
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable, Sequence
from typing import Any

from .config import REQUIRED_MODEL, Settings
from .errors import EndpointError, ResponseContractError, RetryExhaustedError
from .models import CompletionResult, GenerationOptions, Message


Transport = Callable[[urllib.request.Request, float], tuple[int, bytes]]
Sleep = Callable[[float], None]


def _urllib_transport(request: urllib.request.Request, timeout: float) -> tuple[int, bytes]:
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read()


class OrinChatClient:
    def __init__(
        self,
        settings: Settings,
        logger: logging.Logger,
        *,
        transport: Transport = _urllib_transport,
        sleep: Sleep = time.sleep,
    ) -> None:
        settings.validate()
        self._settings = settings
        self._logger = logger
        self._transport = transport
        self._sleep = sleep

    def chat(
        self,
        messages: Sequence[Message],
        options: GenerationOptions | None = None,
    ) -> CompletionResult:
        generation = options or GenerationOptions()
        generation.validate()
        if self._settings.model != REQUIRED_MODEL:
            raise ValueError(f"Only {REQUIRED_MODEL} is permitted")
        if not messages:
            raise ValueError("At least one message is required")

        request_id = str(uuid.uuid4())
        payload: dict[str, Any] = {
            "model": REQUIRED_MODEL,
            "think": generation.think,
            "stream": False,
            "keep_alive": generation.keep_alive,
            "messages": list(messages),
            "options": {
                "temperature": generation.temperature,
                "num_ctx": generation.num_ctx,
                "num_predict": generation.num_predict,
            },
        }
        encoded = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self._settings.endpoint_url,
            data=encoded,
            headers={"Content-Type": "application/json", "X-Request-ID": request_id},
            method="POST",
        )
        self._logger.info(
            "endpoint.request",
            extra={"event": "endpoint.request", "request_id": request_id, "payload": payload},
        )

        last_error: Exception | None = None
        for attempt in range(1, self._settings.max_attempts + 1):
            started = time.monotonic()
            try:
                status, raw = self._transport(request, self._settings.timeout_seconds)
                latency_ms = round((time.monotonic() - started) * 1000, 2)
                if status >= 400:
                    raise EndpointError(raw.decode("utf-8", errors="replace"), status=status)
                return self._parse_response(raw, request_id=request_id, latency_ms=latency_ms, status=status)
            except urllib.error.HTTPError as error:
                latency_ms = round((time.monotonic() - started) * 1000, 2)
                body = error.read().decode("utf-8", errors="replace")
                last_error = EndpointError(body or str(error), status=error.code)
                if error.code != 429 and error.code < 500:
                    self._log_failure(request_id, attempt, latency_ms, last_error, error.code, body)
                    raise last_error from error
            except EndpointError as error:
                latency_ms = round((time.monotonic() - started) * 1000, 2)
                last_error = error
                if error.status != 429 and (error.status or 0) < 500:
                    self._log_failure(request_id, attempt, latency_ms, error, error.status, str(error))
                    raise
            except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as error:
                latency_ms = round((time.monotonic() - started) * 1000, 2)
                last_error = error

            self._log_failure(request_id, attempt, latency_ms, last_error, getattr(last_error, "status", None), None)
            if attempt < self._settings.max_attempts:
                delay = min(self._settings.backoff_seconds * (2 ** (attempt - 1)), 8.0)
                delay += random.uniform(0, delay * 0.2)
                self._logger.warning(
                    "endpoint.retry",
                    extra={
                        "event": "endpoint.retry",
                        "request_id": request_id,
                        "attempt": attempt,
                        "next_attempt": attempt + 1,
                        "delay_ms": round(delay * 1000, 2),
                    },
                )
                self._sleep(delay)

        raise RetryExhaustedError(
            f"Endpoint failed after {self._settings.max_attempts} attempts: {last_error}",
            status=getattr(last_error, "status", None),
        ) from last_error

    def _parse_response(self, raw: bytes, *, request_id: str, latency_ms: float, status: int) -> CompletionResult:
        try:
            data = json.loads(raw)
            message = data["message"]
            answer = message.get("content", "")
            thinking = message.get("thinking", "")
        except (json.JSONDecodeError, KeyError, TypeError, AttributeError) as error:
            self._logger.error(
                "endpoint.contract_error",
                extra={"event": "endpoint.contract_error", "request_id": request_id, "response_body": raw.decode("utf-8", errors="replace")},
            )
            raise ResponseContractError("Endpoint returned an invalid response shape") from error

        result = CompletionResult(
            answer=answer,
            thinking=thinking,
            model=str(data.get("model", "")),
            done=bool(data.get("done", False)),
            done_reason=data.get("done_reason"),
            generated_tokens=data.get("eval_count"),
            latency_ms=latency_ms,
            request_id=request_id,
        )
        self._logger.info(
            "endpoint.response",
            extra={
                "event": "endpoint.response",
                "request_id": request_id,
                "status": status,
                "latency_ms": latency_ms,
                "model": result.model,
                "done": result.done,
                "done_reason": result.done_reason,
                "generated_tokens": result.generated_tokens,
                "response": data,
            },
        )
        return result

    def _log_failure(
        self,
        request_id: str,
        attempt: int,
        latency_ms: float,
        error: Exception | None,
        status: int | None,
        response_body: str | None,
    ) -> None:
        self._logger.error(
            "endpoint.error",
            extra={
                "event": "endpoint.error",
                "request_id": request_id,
                "attempt": attempt,
                "status": status,
                "latency_ms": latency_ms,
                "error_type": type(error).__name__ if error else "UnknownError",
                "error": str(error),
                "response_body": response_body,
            },
        )

