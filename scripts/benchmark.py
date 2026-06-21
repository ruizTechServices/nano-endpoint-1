"""Small sequential benchmark used for a production viability decision."""

from __future__ import annotations

import json
import statistics
import sys

from orin_text.client import OrinChatClient
from orin_text.config import Settings
from orin_text.logging_config import configure_logging
from orin_text.models import GenerationOptions


def main() -> int:
    settings = Settings.from_environment()
    client = OrinChatClient(settings, configure_logging(settings.log_path))
    results = []
    failures = []
    for index in range(3):
        try:
            result = client.chat(
                [{"role": "user", "content": f"Reply with exactly: benchmark {index + 1}"}],
                GenerationOptions(temperature=0, num_ctx=1024, num_predict=32),
            )
            results.append(result)
        except Exception as error:
            failures.append({"index": index + 1, "type": type(error).__name__, "error": str(error)})

    latencies = [result.latency_ms for result in results]
    report = {
        "requests": 3,
        "successes": len(results),
        "failures": failures,
        "success_rate": len(results) / 3,
        "latency_ms": {
            "min": min(latencies) if latencies else None,
            "median": statistics.median(latencies) if latencies else None,
            "max": max(latencies) if latencies else None,
        },
        "generated_tokens": [result.generated_tokens for result in results],
        "answers": [result.answer.strip() for result in results],
    }
    print(json.dumps(report, indent=2))
    return 0 if len(results) == 3 else 1


if __name__ == "__main__":
    sys.exit(main())
