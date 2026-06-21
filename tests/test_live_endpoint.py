from __future__ import annotations

import json
import logging
import os
import unittest

from orin_text.client import OrinChatClient
from orin_text.config import REQUIRED_MODEL, Settings
from orin_text.models import GenerationOptions


@unittest.skipUnless(os.getenv("RUN_LIVE_SMOKE_TEST") == "1", "live endpoint test is opt-in")
class LiveEndpointTests(unittest.TestCase):
    def test_exact_response_contract(self) -> None:
        logger = logging.getLogger("orin_text.tests.live")
        logger.addHandler(logging.NullHandler())
        result = OrinChatClient(Settings.from_environment(), logger).chat(
            [{"role": "user", "content": "Reply with exactly: orin endpoint online"}],
            GenerationOptions(temperature=0, num_ctx=1024, num_predict=32, think=False),
        )
        self.assertEqual(result.model, REQUIRED_MODEL)
        self.assertEqual(result.answer.strip().lower(), "orin endpoint online")
        self.assertTrue(result.done)
        print(
            json.dumps(
                {
                    "model": result.model,
                    "latency_ms": result.latency_ms,
                    "generated_tokens": result.generated_tokens,
                    "done_reason": result.done_reason,
                },
                separators=(",", ":"),
            )
        )


if __name__ == "__main__":
    unittest.main()

