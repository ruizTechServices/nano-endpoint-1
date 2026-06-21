import io
import json
import logging
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from proxy.app import create_server
from proxy.embeddings_client import OpenAIEmbeddingsClient, EmbeddingError
from proxy.save_service import build_and_save
from proxy.security import ValidationError, validate_save_payload
from proxy.supabase_client import SupabaseWriter, SupabaseError, format_vector


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


class FakeBraveClient:
    def search(self, query, count):
        return {"query": query, "results": []}


class FakeEmbeddings:
    def __init__(self):
        self.calls = []

    def embed(self, texts):
        self.calls.append(list(texts))
        return [[float(index), float(index)] for index in range(len(texts))]


class FakeSupabase:
    def __init__(self, existing=None):
        self.upserts = []
        # existing: dict[table_name] -> set of already-stored positions for the conversation
        self._existing = existing or {}

    def existing_positions(self, table, conversation_id):
        return set(self._existing.get(table, set()))

    def upsert(self, table, rows, *, on_conflict):
        self.upserts.append((table, rows, on_conflict))
        return len(rows)


# --------------------------------------------------------------------------- embeddings client


class OpenAIEmbeddingsClientTests(unittest.TestCase):
    def test_embed_orders_vectors_and_hides_key(self):
        captured = {}

        def opener(request, timeout):
            captured["url"] = request.full_url
            captured["headers"] = dict(request.header_items())
            captured["body"] = json.loads(request.data)
            return FakeResponse({"data": [
                {"index": 1, "embedding": [0.3, 0.4]},
                {"index": 0, "embedding": [0.1, 0.2]},
            ]})

        vectors = OpenAIEmbeddingsClient("sk-secret", opener=opener).embed(["a", "b"])
        self.assertEqual(vectors, [[0.1, 0.2], [0.3, 0.4]])
        self.assertEqual(captured["headers"]["Authorization"], "Bearer sk-secret")
        self.assertEqual(captured["body"]["model"], "text-embedding-3-small")
        self.assertEqual(captured["body"]["input"], ["a", "b"])
        self.assertNotIn("sk-secret", captured["url"])

    def test_embed_empty_makes_no_request(self):
        def opener(request, timeout):
            raise AssertionError("opener should not be called for empty input")

        self.assertEqual(OpenAIEmbeddingsClient("sk", opener=opener).embed([]), [])

    def test_embed_maps_auth_error(self):
        def opener(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, io.BytesIO())

        with self.assertRaisesRegex(EmbeddingError, "authentication failed"):
            OpenAIEmbeddingsClient("sk", opener=opener).embed(["x"])

    def test_embed_rejects_mismatched_count(self):
        def opener(request, timeout):
            return FakeResponse({"data": [{"index": 0, "embedding": [0.1]}]})

        with self.assertRaisesRegex(EmbeddingError, "unexpected embeddings shape"):
            OpenAIEmbeddingsClient("sk", opener=opener).embed(["a", "b"])


# --------------------------------------------------------------------------- supabase writer


class SupabaseWriterTests(unittest.TestCase):
    def test_upsert_sends_service_role_and_conflict_target(self):
        captured = {}

        def opener(request, timeout):
            captured["url"] = request.full_url
            captured["headers"] = dict(request.header_items())
            captured["body"] = json.loads(request.data)
            captured["method"] = request.get_method()
            return FakeResponse(b"", status=201)

        writer = SupabaseWriter("https://proj.supabase.co/", "service-secret", opener=opener)
        count = writer.upsert("chat_turns", [{"id": "1"}], on_conflict="conversation_id,position")
        self.assertEqual(count, 1)
        self.assertEqual(captured["method"], "POST")
        self.assertIn("/rest/v1/chat_turns", captured["url"])
        self.assertIn("on_conflict=conversation_id%2Cposition", captured["url"])
        self.assertEqual(captured["headers"]["Apikey"], "service-secret")
        self.assertEqual(captured["headers"]["Authorization"], "Bearer service-secret")
        self.assertEqual(captured["headers"]["Prefer"], "resolution=merge-duplicates,return=minimal")

    def test_upsert_empty_makes_no_request(self):
        def opener(request, timeout):
            raise AssertionError("opener should not be called for empty rows")

        self.assertEqual(SupabaseWriter("https://x.co", "k", opener=opener).upsert("t", [], on_conflict="id"), 0)

    def test_upsert_maps_auth_error(self):
        def opener(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, io.BytesIO())

        with self.assertRaisesRegex(SupabaseError, "authentication failed"):
            SupabaseWriter("https://x.co", "k", opener=opener).upsert("t", [{"id": "1"}], on_conflict="id")

    def test_format_vector(self):
        self.assertEqual(format_vector([1.0, 2.5, -3.0]), "[1.0,2.5,-3.0]")

    def test_existing_positions_parses_rows(self):
        captured = {}

        def opener(request, timeout):
            captured["url"] = request.full_url
            captured["method"] = request.get_method()
            return FakeResponse([{"position": 0}, {"position": 2}])

        positions = SupabaseWriter("https://x.co", "k", opener=opener).existing_positions("chat_turns", 5)
        self.assertEqual(positions, {0, 2})
        self.assertEqual(captured["method"], "GET")
        self.assertIn("conversation_id=eq.5", captured["url"])
        self.assertIn("select=position", captured["url"])


# --------------------------------------------------------------------------- orchestration


class BuildAndSaveTests(unittest.TestCase):
    def _validated(self):
        return {
            "conversation_id": 0,
            "turns": [
                {"id": "t1", "position": 0, "user": "hi", "assistant": "hello", "thinking": "reasoning", "ts": "2026-01-01T00:00:00Z"},
                {"id": "t2", "position": 1, "user": "q", "assistant": "a", "thinking": "", "ts": None},
            ],
            "summaries": [
                {"id": "s1", "conversation_id": 0, "position": 20, "summary": "the summary", "ts": None},
            ],
        }

    def test_assembles_three_tables_and_routes_thinking(self):
        embeddings = FakeEmbeddings()
        supabase = FakeSupabase()
        result = build_and_save(self._validated(), embeddings, supabase)

        self.assertEqual(result["saved_turns"], 2)
        self.assertEqual(result["saved_thinking"], 1)
        self.assertEqual(result["saved_summaries"], 1)

        # Embed inputs ordered: 2 turn contents, then 1 non-empty thinking, then 1 summary.
        inputs = embeddings.calls[0]
        self.assertEqual(len(inputs), 4)
        self.assertTrue(inputs[0].startswith("USER:\nhi\nASSISTANT:\nhello"))
        self.assertEqual(inputs[2], "reasoning")
        self.assertEqual(inputs[3], "the summary")

        tables = [table for table, _rows, _conflict in supabase.upserts]
        self.assertEqual(tables, ["chat_turns", "chat_thinking", "chat_summaries"])

        turn_rows = supabase.upserts[0][1]
        self.assertEqual(turn_rows[0]["user_text"], "hi")
        self.assertEqual(turn_rows[0]["assistant_text"], "hello")
        self.assertTrue(turn_rows[0]["embedding"].startswith("["))
        self.assertNotIn("thinking", turn_rows[0])

        thinking_rows = supabase.upserts[1][1]
        self.assertEqual(len(thinking_rows), 1)
        self.assertEqual(thinking_rows[0]["id"], "t1")
        self.assertEqual(thinking_rows[0]["position"], 0)
        self.assertEqual(thinking_rows[0]["thinking"], "reasoning")

        # Conflict targets: turns + thinking on id, summaries on (conversation_id, position).
        self.assertEqual(supabase.upserts[0][2], "id")
        self.assertEqual(supabase.upserts[1][2], "id")
        self.assertEqual(supabase.upserts[2][2], "conversation_id,position")

        # Nothing pre-existed, so nothing was skipped.
        self.assertEqual(result["skipped_turns"], 0)
        self.assertEqual(result["skipped_thinking"], 0)
        self.assertEqual(result["skipped_summaries"], 0)

    def test_skips_positions_already_in_db_and_only_embeds_new(self):
        embeddings = FakeEmbeddings()
        # Turn 0 and its thinking are already stored; summary position 20 is not.
        supabase = FakeSupabase(existing={"chat_turns": {0}, "chat_thinking": {0}})
        result = build_and_save(self._validated(), embeddings, supabase)

        # Only the new turn (position 1) is saved; turn 0 is skipped (no re-embed).
        self.assertEqual(result["saved_turns"], 1)
        self.assertEqual(result["skipped_turns"], 1)
        # The only turn with thinking is position 0, which already exists -> nothing new.
        self.assertEqual(result["saved_thinking"], 0)
        self.assertEqual(result["skipped_thinking"], 1)
        # Summary is new.
        self.assertEqual(result["saved_summaries"], 1)
        self.assertEqual(result["skipped_summaries"], 0)

        # Embed inputs are ONLY the new work: 1 turn content + 0 thinking + 1 summary = 2.
        self.assertEqual(len(embeddings.calls[0]), 2)

    def test_unchanged_resave_embeds_nothing(self):
        embeddings = FakeEmbeddings()
        supabase = FakeSupabase(existing={"chat_turns": {0, 1}, "chat_thinking": {0}, "chat_summaries": {20}})
        result = build_and_save(self._validated(), embeddings, supabase)
        self.assertEqual(
            {k: v for k, v in result.items() if k.startswith("saved_")},
            {"saved_turns": 0, "saved_thinking": 0, "saved_summaries": 0},
        )
        # Nothing new to embed: zero texts sent to OpenAI.
        self.assertEqual(sum(len(call) for call in embeddings.calls), 0)


# --------------------------------------------------------------------------- validation


class ValidateSavePayloadTests(unittest.TestCase):
    def test_rejects_unsupported_fields(self):
        with self.assertRaises(ValidationError):
            validate_save_payload({"conversationId": 0, "turns": [], "summaries": [], "extra": 1})

    def test_rejects_negative_conversation_id(self):
        with self.assertRaises(ValidationError):
            validate_save_payload({"conversationId": -1, "turns": [], "summaries": []})

    def test_rejects_empty_save(self):
        with self.assertRaises(ValidationError):
            validate_save_payload({"conversationId": 0, "turns": [], "summaries": []})

    def test_summary_defaults_conversation_id(self):
        validated = validate_save_payload({
            "conversationId": 3,
            "turns": [],
            "summaries": [{"id": "s1", "position": 0, "summary": "x"}],
        })
        self.assertEqual(validated["summaries"][0]["conversation_id"], 3)


# --------------------------------------------------------------------------- route (configured)


class SaveRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from proxy.security import RateLimiter

        web_root = Path(__file__).resolve().parents[1] / "web"
        cls.embeddings = FakeEmbeddings()
        cls.supabase = FakeSupabase()
        cls.server = create_server(
            "127.0.0.1", 0, web_root=web_root, brave_client=FakeBraveClient(),
            rate_limiter=RateLimiter(requests=100), logger=logging.getLogger("save-test"),
            embeddings_client=cls.embeddings, supabase_writer=cls.supabase,
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def _post(self, payload):
        request = urllib.request.Request(
            self.base + "/api/save-history",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        return urllib.request.urlopen(request)

    def test_happy_path_returns_counts(self):
        payload = {
            "conversationId": 0,
            "turns": [{"id": "t1", "position": 0, "user": "hi", "assistant": "yo", "thinking": "", "ts": None}],
            "summaries": [],
        }
        with self._post(payload) as response:
            body = json.loads(response.read())
        self.assertEqual(response.status, 200)
        self.assertEqual(body["saved_turns"], 1)
        self.assertEqual(body["saved_thinking"], 0)
        self.assertEqual(body["saved_summaries"], 0)
        self.assertEqual(body["skipped_turns"], 0)

    def test_rejects_unsupported_fields(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self._post({"conversationId": 0, "turns": [], "summaries": [], "oops": 1})
        self.assertEqual(error.exception.code, 400)

    def test_get_not_allowed(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.base + "/api/save-history")
        self.assertEqual(error.exception.code, 405)


# --------------------------------------------------------------------------- route (unconfigured)


class SaveRouteUnconfiguredTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from proxy.security import RateLimiter

        web_root = Path(__file__).resolve().parents[1] / "web"
        cls.server = create_server(
            "127.0.0.1", 0, web_root=web_root, brave_client=FakeBraveClient(),
            rate_limiter=RateLimiter(requests=100), logger=logging.getLogger("save-test-503"),
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_returns_503_when_cloud_save_not_configured(self):
        request = urllib.request.Request(
            self.base + "/api/save-history",
            data=json.dumps({"conversationId": 0, "turns": [{"id": "t1", "position": 0, "user": "a", "assistant": "b", "thinking": "", "ts": None}], "summaries": []}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code, 503)


if __name__ == "__main__":
    unittest.main()
