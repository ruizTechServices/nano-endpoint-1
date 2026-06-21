"""Run Orin Local with its secure same-origin Brave Search proxy."""

from __future__ import annotations

import argparse
import ipaddress
import os
from pathlib import Path

from proxy.app import create_server
from proxy.brave_client import BraveSearchClient
from proxy.embeddings_client import OpenAIEmbeddingsClient
from proxy.logging_config import configure_server_logging
from proxy.supabase_client import SupabaseWriter


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description="Serve Orin Local and its Brave Search proxy")
    command.add_argument("--host", default="127.0.0.1")
    command.add_argument("--port", type=int, default=5500)
    return command


def main() -> int:
    arguments = parser().parse_args()
    try:
        if not ipaddress.ip_address(arguments.host).is_loopback:
            raise ValueError
    except ValueError:
        raise SystemExit("--host must be a loopback IP address such as 127.0.0.1") from None
    api_key = os.getenv("BRAVE_SEARCH_API_KEY")
    if not api_key or not api_key.strip():
        raise SystemExit("BRAVE_SEARCH_API_KEY is not available to the server process")

    # Cloud save (OpenAI embeddings + Supabase) is optional. When any credential is missing the
    # app still runs and /api/save-history responds 503, so the local-only experience is unchanged.
    openai_api_key = os.getenv("OPENAI_API_KEY")
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    embeddings_client = None
    supabase_writer = None
    if openai_api_key and supabase_url and supabase_service_role_key:
        embeddings_client = OpenAIEmbeddingsClient(openai_api_key)
        supabase_writer = SupabaseWriter(supabase_url, supabase_service_role_key)

    logger = configure_server_logging()
    web_root = Path(__file__).resolve().parent / "web"
    server = create_server(
        arguments.host,
        arguments.port,
        web_root=web_root,
        brave_client=BraveSearchClient(api_key),
        logger=logger,
        embeddings_client=embeddings_client,
        supabase_writer=supabase_writer,
    )
    logger.info(
        "server.started",
        extra={
            "host": arguments.host,
            "port": server.server_port,
            "web_root": str(web_root),
            "cloud_save": embeddings_client is not None,
        },
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("server.stopped")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
