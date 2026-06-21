from __future__ import annotations

import unittest

from orin_text.errors import EmptyAnswerError
from orin_text.models import CompletionResult
from orin_text.service import TextAssistant


class FakeClient:
    def __init__(self, answer: str = "done") -> None:
        self.answer = answer
        self.messages = []
        self.options = None

    def chat(self, messages, options):
        self.messages = messages
        self.options = options
        return CompletionResult(
            answer=self.answer,
            thinking="",
            model="qwen3:1.7b",
            done=True,
            done_reason="stop",
            generated_tokens=3,
            latency_ms=10,
            request_id="test",
        )


class ServiceTests(unittest.TestCase):
    def test_builds_operation_specific_messages(self) -> None:
        client = FakeClient()
        result = TextAssistant(client).run("extract", " Meeting notes ")
        self.assertEqual(result.answer, "done")
        self.assertIn("action items", client.messages[0]["content"])
        self.assertEqual(client.messages[1]["content"], "Meeting notes")

    def test_rejects_empty_input(self) -> None:
        with self.assertRaises(ValueError):
            TextAssistant(FakeClient()).run("summarize", "  ")

    def test_rejects_empty_model_answer(self) -> None:
        with self.assertRaises(EmptyAnswerError):
            TextAssistant(FakeClient(answer="")).run("rewrite", "input")


if __name__ == "__main__":
    unittest.main()

