import json
import logging
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from proxy.app import create_server
from proxy.security import RateLimiter


class FakeBraveClient:
    def __init__(self):
        self.calls = []

    def search(self, query, count):
        self.calls.append((query, count))
        return {"query": query, "results": [{
            "title": "Python Documentation",
            "url": "https://docs.python.org/3/",
            "description": "Official documentation",
            "age": "today",
        }]}


class ProxyAppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = FakeBraveClient()
        web_root = Path(__file__).resolve().parents[1] / "web"
        cls.server = create_server(
            "127.0.0.1", 0, web_root=web_root, brave_client=cls.client,
            rate_limiter=RateLimiter(requests=20), logger=logging.getLogger("proxy-test"),
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_root_serves_existing_index_with_security_headers(self):
        with urllib.request.urlopen(self.base + "/") as response:
            body = response.read().decode()
            self.assertIn("Orin Local", body)
            self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(self.base + "/server.py")
        self.assertEqual(context.exception.code, 404)

    def test_search_route_forwards_validated_data(self):
        request = urllib.request.Request(
            self.base + "/api/brave-search",
            data=json.dumps({"query": "python docs", "count": 5}).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(request) as response:
            payload = json.loads(response.read())
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(payload["query"], "python docs")
        self.assertIn(("python docs", 5), self.client.calls)

    def test_api_rejects_wrong_method_content_type_and_fields(self):
        with self.assertRaises(urllib.error.HTTPError) as get_error:
            urllib.request.urlopen(self.base + "/api/brave-search")
        self.assertEqual(get_error.exception.code, 405)

        for headers, body in [
            ({"Content-Type": "text/plain"}, b"{}"),
            ({"Content-Type": "application/json"}, json.dumps({"query": "ok", "key": "secret"}).encode()),
        ]:
            request = urllib.request.Request(self.base + "/api/brave-search", data=body, headers=headers, method="POST")
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
