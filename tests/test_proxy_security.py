import unittest

from proxy.security import RateLimiter, ValidationError, validate_search_payload


class ProxySecurityTests(unittest.TestCase):
    def test_validates_and_bounds_payload(self):
        self.assertEqual(validate_search_payload({"query": "  python docs ", "count": 3}), ("python docs", 3))
        for payload in ({"query": "x"}, {"query": "python", "count": 11}, {"query": "python", "api_key": "bad"}):
            with self.assertRaises(ValidationError):
                validate_search_payload(payload)

    def test_rate_limiter_is_per_client_and_expires(self):
        now = [0.0]
        limiter = RateLimiter(requests=2, window_seconds=10, clock=lambda: now[0])
        self.assertTrue(limiter.allow("a"))
        self.assertTrue(limiter.allow("a"))
        self.assertFalse(limiter.allow("a"))
        self.assertTrue(limiter.allow("b"))
        now[0] = 11
        self.assertTrue(limiter.allow("a"))


if __name__ == "__main__":
    unittest.main()
