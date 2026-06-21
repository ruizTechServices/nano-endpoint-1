"""Command-line boundary for the private text utility."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence

from .client import OrinChatClient
from .config import Settings
from .errors import OrinTextError
from .logging_config import configure_logging
from .service import TextAssistant


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="orin-text", description="Private text operations using qwen3:1.7b on Orin Nano")
    parser.add_argument("operation", choices=("summarize", "rewrite", "extract", "ask"))
    parser.add_argument("text", nargs="?", help="Input text; reads stdin when omitted")
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--num-ctx", type=int, default=2048)
    parser.add_argument("--num-predict", type=int, default=512)
    parser.add_argument("--think", action="store_true")
    parser.add_argument("--metadata", action="store_true", help="Write inference metadata as JSON to stderr")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    text = args.text if args.text is not None else sys.stdin.read()
    settings = Settings.from_environment()
    logger = configure_logging(settings.log_path)
    assistant = TextAssistant(OrinChatClient(settings, logger))

    try:
        result = assistant.run(
            args.operation,
            text,
            temperature=args.temperature,
            num_ctx=args.num_ctx,
            num_predict=max(args.num_predict, 1024) if args.think else args.num_predict,
            think=args.think,
        )
    except (OrinTextError, ValueError) as error:
        logger.error("cli.failure", extra={"event": "cli.failure", "error_type": type(error).__name__, "error": str(error)})
        print(f"error: {error}", file=sys.stderr)
        return 2

    print(result.answer)
    if args.metadata:
        print(
            json.dumps(
                {
                    "request_id": result.request_id,
                    "model": result.model,
                    "latency_ms": result.latency_ms,
                    "generated_tokens": result.generated_tokens,
                    "done_reason": result.done_reason,
                },
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

