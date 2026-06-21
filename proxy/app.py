"""Same-origin static server and Brave Search API proxy."""

from __future__ import annotations

import json
import logging
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .brave_client import BraveSearchClient, BraveSearchError
from .embeddings_client import EmbeddingError, OpenAIEmbeddingsClient
from .save_service import build_and_save
from .security import (
    MAX_BODY_BYTES,
    MAX_SAVE_BODY_BYTES,
    RateLimiter,
    ValidationError,
    validate_save_payload,
    validate_search_payload,
)
from .supabase_client import SupabaseError, SupabaseWriter


CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self'; "
    "img-src 'self' data:; "
    "connect-src 'self' http://100.86.175.53:11435 https://timeapi.io "
    "https://api.open-meteo.com https://geocoding-api.open-meteo.com; "
    "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
)


def create_handler(
    *,
    web_root: Path,
    brave_client: BraveSearchClient,
    rate_limiter: RateLimiter,
    logger: logging.Logger,
    embeddings_client: OpenAIEmbeddingsClient | None = None,
    supabase_writer: SupabaseWriter | None = None,
) -> type[SimpleHTTPRequestHandler]:
    class ProxyHandler(SimpleHTTPRequestHandler):
        server_version = "OrinLocal/1.0"
        sys_version = ""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, directory=str(web_root), **kwargs)

        def end_headers(self) -> None:
            self.send_header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
            # No-store on every response (static assets included) so the browser can never serve
            # stale JS/CSS after an update. Single source of truth for caching on this server.
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_GET(self) -> None:  # noqa: N802
            if urlsplit(self.path).path.startswith("/api/"):
                self._send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Method not allowed"})
                return
            super().do_GET()

        def do_POST(self) -> None:  # noqa: N802
            route = urlsplit(self.path).path
            if route == "/api/brave-search":
                self._handle_brave_search()
            elif route == "/api/save-history":
                self._handle_save_history()
            else:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "API route not found"})

        def _handle_brave_search(self) -> None:
            started = time.monotonic()
            client = self.client_address[0]
            if not rate_limiter.allow(client):
                self._send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Local search rate limit reached"})
                self._log_api("/api/brave-search", HTTPStatus.TOO_MANY_REQUESTS, started)
                return
            try:
                payload = self._read_json_body()
                query, count = validate_search_payload(payload)
                result = brave_client.search(query, count)
                self._send_json(HTTPStatus.OK, result)
                self._log_api("/api/brave-search", HTTPStatus.OK, started, result_count=len(result["results"]))
            except ValidationError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                self._log_api("/api/brave-search", HTTPStatus.BAD_REQUEST, started)
            except BraveSearchError as error:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
                self._log_api("/api/brave-search", HTTPStatus.BAD_GATEWAY, started)
            except Exception:
                logger.exception("proxy.internal_error", extra={"route": "/api/brave-search"})
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Internal proxy error"})
                self._log_api("/api/brave-search", HTTPStatus.INTERNAL_SERVER_ERROR, started)

        def _handle_save_history(self) -> None:
            started = time.monotonic()
            client = self.client_address[0]
            if embeddings_client is None or supabase_writer is None:
                self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Cloud save is not configured"})
                self._log_api("/api/save-history", HTTPStatus.SERVICE_UNAVAILABLE, started)
                return
            if not rate_limiter.allow(client):
                self._send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Local save rate limit reached"})
                self._log_api("/api/save-history", HTTPStatus.TOO_MANY_REQUESTS, started)
                return
            try:
                payload = self._read_json_body(MAX_SAVE_BODY_BYTES)
                validated = validate_save_payload(payload)
                result = build_and_save(validated, embeddings_client, supabase_writer)
                self._send_json(HTTPStatus.OK, result)
                self._log_api("/api/save-history", HTTPStatus.OK, started, **result)
            except ValidationError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                self._log_api("/api/save-history", HTTPStatus.BAD_REQUEST, started)
            except (EmbeddingError, SupabaseError) as error:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
                self._log_api("/api/save-history", HTTPStatus.BAD_GATEWAY, started)
            except Exception:
                logger.exception("proxy.internal_error", extra={"route": "/api/save-history"})
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Internal proxy error"})
                self._log_api("/api/save-history", HTTPStatus.INTERNAL_SERVER_ERROR, started)

        def _read_json_body(self, max_bytes: int = MAX_BODY_BYTES) -> Any:
            media_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if media_type != "application/json":
                raise ValidationError("Content-Type must be application/json")
            raw_length = self.headers.get("Content-Length")
            try:
                length = int(raw_length or "")
            except ValueError as error:
                raise ValidationError("A valid Content-Length is required") from error
            if length < 1 or length > max_bytes:
                raise ValidationError(f"Request body must be between 1 and {max_bytes} bytes")
            try:
                return json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                raise ValidationError("Request body must contain valid JSON") from error

        def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
            encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def _log_api(self, route: str, status: HTTPStatus, started: float, **fields: Any) -> None:
            logger.info(
                "proxy.request",
                extra={
                    "route": route,
                    "method": "POST",
                    "status": int(status),
                    "latency_ms": round((time.monotonic() - started) * 1000, 2),
                    "client": self.client_address[0],
                    **fields,
                },
            )

        def log_message(self, format: str, *args: Any) -> None:
            if not urlsplit(self.path).path.startswith("/api/"):
                logger.info(
                    "static.request",
                    extra={"method": self.command, "path": urlsplit(self.path).path, "client": self.client_address[0]},
                )

    return ProxyHandler


def create_server(
    host: str,
    port: int,
    *,
    web_root: Path,
    brave_client: BraveSearchClient,
    rate_limiter: RateLimiter | None = None,
    logger: logging.Logger,
    embeddings_client: OpenAIEmbeddingsClient | None = None,
    supabase_writer: SupabaseWriter | None = None,
) -> ThreadingHTTPServer:
    if not web_root.is_dir() or not (web_root / "index.html").is_file():
        raise ValueError("Web root must contain index.html")
    handler = create_handler(
        web_root=web_root.resolve(),
        brave_client=brave_client,
        rate_limiter=rate_limiter or RateLimiter(),
        logger=logger,
        embeddings_client=embeddings_client,
        supabase_writer=supabase_writer,
    )
    return ThreadingHTTPServer((host, port), handler)
