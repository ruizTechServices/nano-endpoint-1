"""Local browser-smoke server with a deterministic Brave client."""

import argparse
import logging
from pathlib import Path

from proxy.app import create_server


class FakeBraveClient:
    def search(self, query: str, count: int = 5) -> dict:
        return {
            "query": query,
            "results": [{
                "title": "Python Documentation",
                "url": "https://docs.python.org/3/",
                "description": "The official documentation for the Python programming language.",
                "age": "",
            }],
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8088)
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    server = create_server(
        "127.0.0.1",
        arguments.port,
        web_root=root / "web",
        brave_client=FakeBraveClient(),
        logger=logging.getLogger("browser-smoke"),
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()
