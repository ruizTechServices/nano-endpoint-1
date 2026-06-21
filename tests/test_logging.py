from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from orin_text.logging_config import close_logging, configure_logging


class LoggingTests(unittest.TestCase):
    def test_writes_structured_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.jsonl"
            logger = configure_logging(path)
            logger.info("endpoint.request", extra={"event": "endpoint.request", "request_id": "abc", "payload": {"model": "qwen3:1.7b"}})
            for handler in logger.handlers:
                handler.flush()
            event = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(event["event"], "endpoint.request")
            self.assertEqual(event["request_id"], "abc")
            self.assertEqual(event["payload"]["model"], "qwen3:1.7b")
            self.assertIn("timestamp", event)
            close_logging(logger)


if __name__ == "__main__":
    unittest.main()
