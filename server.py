"""Run Orin Local with its secure same-origin Brave Search proxy."""

from __future__ import annotations

import argparse
import ipaddress
import os
from pathlib import Path

from proxy.app import create_server
from proxy.brave_client import BraveSearchClient
from proxy.logging_config import configure_server_logging


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
    logger = configure_server_logging()
    web_root = Path(__file__).resolve().parent / "web"
    server = create_server(
        arguments.host,
        arguments.port,
        web_root=web_root,
        brave_client=BraveSearchClient(api_key),
        logger=logger,
    )
    logger.info("server.started", extra={"host": arguments.host, "port": server.server_port, "web_root": str(web_root)})
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("server.stopped")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
