"""Minimal, credential-safe OpenAI embeddings client."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any


OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
MAX_INPUTS_PER_REQUEST = 128


class EmbeddingError(Exception):
    """A safe embeddings failure without credential details."""


Opener = Callable[[urllib.request.Request, float], Any]


class OpenAIEmbeddingsClient:
    def __init__(
        self,
        api_key: str,
        *,
        model: str = EMBEDDING_MODEL,
        timeout_seconds: float = 30.0,
        opener: Opener = urllib.request.urlopen,
    ) -> None:
        if not api_key or not api_key.strip():
            raise ValueError("OpenAI API key is required")
        self._api_key = api_key.strip()
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._opener = opener

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one embedding vector per input text, preserving order."""
        if not texts:
            return []
        vectors: list[list[float]] = []
        for start in range(0, len(texts), MAX_INPUTS_PER_REQUEST):
            vectors.extend(self._embed_batch(texts[start : start + MAX_INPUTS_PER_REQUEST]))
        return vectors

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        body = json.dumps({"model": self._model, "input": batch}).encode("utf-8")
        request = urllib.request.Request(
            OPENAI_EMBEDDINGS_URL,
            data=body,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "OrinLocal/1.0",
            },
            method="POST",
        )
        try:
            with self._opener(request, timeout=self._timeout_seconds) as response:
                status = getattr(response, "status", 200)
                raw = response.read()
        except urllib.error.HTTPError as error:
            if error.code == 401:
                raise EmbeddingError("OpenAI authentication failed") from error
            if error.code == 429:
                raise EmbeddingError("OpenAI rate limit reached") from error
            raise EmbeddingError(f"OpenAI returned HTTP {error.code}") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise EmbeddingError("OpenAI is currently unavailable") from error

        if status != 200:
            raise EmbeddingError(f"OpenAI returned HTTP {status}")
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise EmbeddingError("OpenAI returned invalid JSON") from error

        data = payload.get("data")
        if not isinstance(data, list) or len(data) != len(batch):
            raise EmbeddingError("OpenAI returned an unexpected embeddings shape")
        ordered = sorted(
            data,
            key=lambda item: item.get("index", 0) if isinstance(item, dict) else 0,
        )
        vectors: list[list[float]] = []
        for item in ordered:
            embedding = item.get("embedding") if isinstance(item, dict) else None
            if not isinstance(embedding, list) or not embedding:
                raise EmbeddingError("OpenAI returned an invalid embedding vector")
            vectors.append(embedding)
        return vectors
