import io
import json
import unittest
import urllib.error
from urllib.parse import parse_qs, urlsplit

from proxy.brave_client import BRAVE_WEB_SEARCH_URL, BraveSearchClient, BraveSearchError


class FakeResponse:
    def __init__(self, payload, status=200):
        self.status = status
        self._payload = payload if isinstance(payload, bytes) else json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return self._payload


class BraveSearchClientTests(unittest.TestCase):
    def test_uses_fixed_endpoint_header_and_normalizes_results(self):
        observed = {}

        def opener(request, timeout):
            observed.update(url=request.full_url, headers=dict(request.header_items()), timeout=timeout)
            return FakeResponse({"web": {"results": [
                {"title": " Python docs ", "url": "https://docs.python.org/3/", "description": " Official ", "age": "today"},
                {"title": "unsafe", "url": "javascript:alert(1)"},
            ]}})

        result = BraveSearchClient("top-secret", opener=opener).search("python docs", 5)
        parsed = urlsplit(observed["url"])
        self.assertEqual(f"{parsed.scheme}://{parsed.netloc}{parsed.path}", BRAVE_WEB_SEARCH_URL)
        self.assertEqual(parse_qs(parsed.query)["q"], ["python docs"])
        self.assertEqual(observed["headers"]["X-subscription-token"], "top-secret")
        self.assertNotIn("top-secret", observed["url"])
        self.assertEqual(len(result["results"]), 1)
        self.assertEqual(result["results"][0]["title"], "Python docs")

    def test_maps_upstream_failures_to_safe_errors(self):
        def unauthorized(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, io.BytesIO())

        with self.assertRaisesRegex(BraveSearchError, "authentication failed"):
            BraveSearchClient("secret", opener=unauthorized).search("python")

    def test_rejects_invalid_json(self):
        with self.assertRaisesRegex(BraveSearchError, "invalid JSON"):
            BraveSearchClient("secret", opener=lambda *_, **__: FakeResponse(b"not-json")).search("python")


if __name__ == "__main__":
    unittest.main()
