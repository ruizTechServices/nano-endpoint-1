from __future__ import annotations

import json
import logging
import urllib.error
import unittest

from orin_text.client import OrinChatClient
from orin_text.config import REQUIRED_MODEL, Settings
from orin_text.errors import EndpointError, RetryExhaustedError
from orin_text.models import GenerationOptions


def logger() -> logging.Logger:
    instance = logging.getLogger("orin_text.tests.client")
    instance.handlers.clear()
    instance.addHandler(logging.NullHandler())
    return instance


class ClientTests(unittest.TestCase):
    def test_sends_documented_payload_and_parses_usage(self) -> None:
        observed: dict = {}

        def transport(request, timeout):
            observed.update(json.loads(request.data))
            self.assertEqual(timeout, 2)
            return 200, json.dumps(
                {
                    "model": REQUIRED_MODEL,
                    "message": {"role": "assistant", "content": "result", "thinking": ""},
                    "done": True,
                    "done_reason": "stop",
                    "eval_count": 7,
                }
            ).encode()

        client = OrinChatClient(Settings(timeout_seconds=2), logger(), transport=transport)
        result = client.chat([{"role": "user", "content": "hello"}])

        self.assertEqual(observed["model"], REQUIRED_MODEL)
        self.assertFalse(observed["stream"])
        self.assertEqual(observed["options"]["num_ctx"], 2048)
        self.assertEqual(result.answer, "result")
        self.assertEqual(result.generated_tokens, 7)

    def test_retries_transient_failures(self) -> None:
        attempts = 0
        delays: list[float] = []

        def transport(request, timeout):
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise urllib.error.URLError("temporary")
            return 200, b'{"model":"qwen3:1.7b","message":{"content":"ok"},"done":true}'

        settings = Settings(max_attempts=3, backoff_seconds=0)
        result = OrinChatClient(settings, logger(), transport=transport, sleep=delays.append).chat(
            [{"role": "user", "content": "hello"}]
        )
        self.assertEqual(result.answer, "ok")
        self.assertEqual(attempts, 3)
        self.assertEqual(len(delays), 2)

    def test_does_not_retry_permanent_http_failure(self) -> None:
        attempts = 0

        def transport(request, timeout):
            nonlocal attempts
            attempts += 1
            raise EndpointError("bad request", status=400)

        client = OrinChatClient(Settings(max_attempts=3), logger(), transport=transport, sleep=lambda _: None)
        with self.assertRaises(EndpointError):
            client.chat([{"role": "user", "content": "hello"}])
        self.assertEqual(attempts, 1)

    def test_raises_after_retry_budget(self) -> None:
        def transport(request, timeout):
            raise urllib.error.URLError("offline")

        client = OrinChatClient(Settings(max_attempts=2, backoff_seconds=0), logger(), transport=transport, sleep=lambda _: None)
        with self.assertRaises(RetryExhaustedError):
            client.chat([{"role": "user", "content": "hello"}])

    def test_thinking_requires_documented_output_budget(self) -> None:
        client = OrinChatClient(Settings(), logger(), transport=lambda *_: (200, b"{}"))
        with self.assertRaises(ValueError):
            client.chat(
                [{"role": "user", "content": "hello"}],
                GenerationOptions(think=True, num_predict=512),
            )


if __name__ == "__main__":
    unittest.main()

