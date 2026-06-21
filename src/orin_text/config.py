"""Runtime configuration with safe, documented defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


DOCUMENTED_ENDPOINT = "http://100.86.175.53:11435/api/chat"
REQUIRED_MODEL = "qwen3:1.7b"


@dataclass(frozen=True, slots=True)
class Settings:
    endpoint_url: str = DOCUMENTED_ENDPOINT
    model: str = REQUIRED_MODEL
    timeout_seconds: float = 90.0
    max_attempts: int = 3
    backoff_seconds: float = 0.5
    log_path: Path = Path("logs/orin-text.jsonl")

    @classmethod
    def from_environment(cls) -> "Settings":
        settings = cls(
            endpoint_url=os.getenv("ORIN_ENDPOINT_URL", DOCUMENTED_ENDPOINT),
            timeout_seconds=float(os.getenv("ORIN_TIMEOUT_SECONDS", "90")),
            max_attempts=int(os.getenv("ORIN_MAX_ATTEMPTS", "3")),
            backoff_seconds=float(os.getenv("ORIN_RETRY_BACKOFF_SECONDS", "0.5")),
            log_path=Path(os.getenv("ORIN_LOG_PATH", "logs/orin-text.jsonl")),
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        if self.model != REQUIRED_MODEL:
            raise ValueError(f"Only {REQUIRED_MODEL} is permitted")
        if not self.endpoint_url.startswith(("http://", "https://")):
            raise ValueError("Endpoint URL must use HTTP or HTTPS")
        if self.timeout_seconds <= 0 or self.max_attempts < 1 or self.backoff_seconds < 0:
            raise ValueError("Invalid timeout or retry configuration")

