"""Minimal, credential-safe Brave Web Search client."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any


BRAVE_WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"


class BraveSearchError(Exception):
    """A safe upstream-search failure without credential details."""


Opener = Callable[[urllib.request.Request, float], Any]


class BraveSearchClient:
    def __init__(
        self,
        api_key: str,
        *,
        timeout_seconds: float = 15.0,
        opener: Opener = urllib.request.urlopen,
    ) -> None:
        if not api_key or not api_key.strip():
            raise ValueError("Brave Search API key is required")
        self._api_key = api_key.strip()
        self._timeout_seconds = timeout_seconds
        self._opener = opener

    def search(self, query: str, count: int = 5) -> dict[str, Any]:
        parameters = urllib.parse.urlencode(
            {
                "q": query,
                "count": count,
                "safesearch": "moderate",
                "text_decorations": "false",
                "spellcheck": "true",
            }
        )
        request = urllib.request.Request(
            f"{BRAVE_WEB_SEARCH_URL}?{parameters}",
            headers={
                "Accept": "application/json",
                "X-Subscription-Token": self._api_key,
                "User-Agent": "OrinLocal/1.0",
            },
            method="GET",
        )
        try:
            with self._opener(request, timeout=self._timeout_seconds) as response:
                status = getattr(response, "status", 200)
                raw = response.read()
        except urllib.error.HTTPError as error:
            if error.code == 401:
                raise BraveSearchError("Brave Search authentication failed") from error
            if error.code == 429:
                raise BraveSearchError("Brave Search rate limit reached") from error
            raise BraveSearchError(f"Brave Search returned HTTP {error.code}") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise BraveSearchError("Brave Search is currently unavailable") from error

        if status != 200:
            raise BraveSearchError(f"Brave Search returned HTTP {status}")
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise BraveSearchError("Brave Search returned invalid JSON") from error

        raw_results = payload.get("web", {}).get("results", [])
        if not isinstance(raw_results, list):
            raise BraveSearchError("Brave Search returned an invalid result shape")
        results = []
        for item in raw_results[:count]:
            normalized = self._normalize_result(item)
            if normalized is not None:
                results.append(normalized)
        return {"query": query, "results": results}

    @staticmethod
    def _normalize_result(item: Any) -> dict[str, str] | None:
        if not isinstance(item, dict):
            return None
        title = item.get("title")
        url = item.get("url")
        if not isinstance(title, str) or not title.strip() or not isinstance(url, str):
            return None
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return None
        description = item.get("description", "")
        age = item.get("age", "")
        return {
            "title": title.strip()[:500],
            "url": url[:2048],
            "description": description.strip()[:2000] if isinstance(description, str) else "",
            "age": age.strip()[:100] if isinstance(age, str) else "",
        }
