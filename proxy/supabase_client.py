"""Minimal, credential-safe Supabase REST (PostgREST) upsert client."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any


class SupabaseError(Exception):
    """A safe Supabase failure without credential details."""


Opener = Callable[[urllib.request.Request, float], Any]


def format_vector(values: list[float]) -> str:
    """Render an embedding as the pgvector text literal PostgREST expects: "[1,2,3]"."""
    return "[" + ",".join(repr(float(value)) for value in values) + "]"


class SupabaseWriter:
    def __init__(
        self,
        base_url: str,
        service_role_key: str,
        *,
        timeout_seconds: float = 20.0,
        opener: Opener = urllib.request.urlopen,
    ) -> None:
        if not base_url or not base_url.strip():
            raise ValueError("Supabase URL is required")
        if not service_role_key or not service_role_key.strip():
            raise ValueError("Supabase service-role key is required")
        self._base_url = base_url.strip().rstrip("/")
        self._service_role_key = service_role_key.strip()
        self._timeout_seconds = timeout_seconds
        self._opener = opener

    def existing_positions(self, table: str, conversation_id: int) -> set[int]:
        """Return the `position` values already stored for a conversation in `table`.

        Used to skip rows that are already saved unchanged (turns are immutable once created),
        so re-saving a conversation does not re-embed everything.
        """
        url = (
            f"{self._base_url}/rest/v1/{urllib.parse.quote(table)}"
            f"?conversation_id=eq.{int(conversation_id)}&select=position"
        )
        request = urllib.request.Request(
            url,
            headers={
                "apikey": self._service_role_key,
                "Authorization": f"Bearer {self._service_role_key}",
                "Accept": "application/json",
                "User-Agent": "OrinLocal/1.0",
            },
            method="GET",
        )
        try:
            with self._opener(request, timeout=self._timeout_seconds) as response:
                status = getattr(response, "status", 200)
                raw = response.read()
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise SupabaseError("Supabase authentication failed") from error
            raise SupabaseError(f"Supabase returned HTTP {error.code}") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise SupabaseError("Supabase is currently unavailable") from error

        if status not in (200, 206):
            raise SupabaseError(f"Supabase returned HTTP {status}")
        try:
            rows = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise SupabaseError("Supabase returned invalid JSON") from error
        if not isinstance(rows, list):
            raise SupabaseError("Supabase returned an unexpected response shape")
        return {
            row["position"]
            for row in rows
            if isinstance(row, dict) and isinstance(row.get("position"), int)
        }

    def upsert(self, table: str, rows: list[dict[str, Any]], *, on_conflict: str) -> int:
        """Upsert rows into a table, resolving duplicates on the given conflict target."""
        if not rows:
            return 0
        url = (
            f"{self._base_url}/rest/v1/{urllib.parse.quote(table)}"
            f"?on_conflict={urllib.parse.quote(on_conflict)}"
        )
        body = json.dumps(rows).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "apikey": self._service_role_key,
                "Authorization": f"Bearer {self._service_role_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
                "User-Agent": "OrinLocal/1.0",
            },
            method="POST",
        )
        try:
            with self._opener(request, timeout=self._timeout_seconds) as response:
                status = getattr(response, "status", 200)
                response.read()
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise SupabaseError("Supabase authentication failed") from error
            raise SupabaseError(f"Supabase returned HTTP {error.code}") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise SupabaseError("Supabase is currently unavailable") from error

        if status not in (200, 201, 204):
            raise SupabaseError(f"Supabase returned HTTP {status}")
        return len(rows)
