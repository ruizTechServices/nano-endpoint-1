"""Embed a saved conversation snapshot and upsert it into Supabase pgvector.

Three tables are written, mirroring the IndexedDB shapes:
  * chat_turns      one row per turn (user+assistant text + combined embedding)
  * chat_thinking   one row per turn that has non-empty thinking (own embedding)
  * chat_summaries  one row per rolling-summary checkpoint (own embedding)

chat_thinking.id is a foreign key to chat_turns.id, so turns are upserted first.
"""

from __future__ import annotations

from typing import Any

from .embeddings_client import EmbeddingError
from .supabase_client import format_vector


def _turn_content(turn: dict[str, Any]) -> str:
    return f"USER:\n{turn['user']}\nASSISTANT:\n{turn['assistant']}"


def build_and_save(
    validated: dict[str, Any],
    embeddings_client: Any,
    supabase_writer: Any,
) -> dict[str, int]:
    conversation_id = validated["conversation_id"]
    turns = validated["turns"]
    summaries = validated["summaries"]

    # Skip anything already stored for this conversation so we never re-embed (a paid OpenAI call)
    # rows that haven't changed. Turns are immutable once created and "Delete all" mints a new
    # conversation id, so a (conversation_id, position) already present means it's unchanged.
    saved_turn_positions = supabase_writer.existing_positions("chat_turns", conversation_id)
    saved_thinking_positions = supabase_writer.existing_positions("chat_thinking", conversation_id)
    saved_summary_positions = supabase_writer.existing_positions("chat_summaries", conversation_id)

    skipped_turns = sum(1 for turn in turns if turn["position"] in saved_turn_positions)
    turns = [turn for turn in turns if turn["position"] not in saved_turn_positions]

    thinking_turns_all = [turn for turn in validated["turns"] if turn["thinking"].strip()]
    skipped_thinking = sum(1 for turn in thinking_turns_all if turn["position"] in saved_thinking_positions)
    thinking_turns = [turn for turn in thinking_turns_all if turn["position"] not in saved_thinking_positions]

    skipped_summaries = sum(1 for s in summaries if s["position"] in saved_summary_positions)
    summaries = [s for s in summaries if s["position"] not in saved_summary_positions]

    # Build embed inputs in a stable order so vectors can be split back out by offset.
    texts: list[str] = [_turn_content(turn) for turn in turns]
    texts.extend(turn["thinking"] for turn in thinking_turns)
    texts.extend(summary["summary"] for summary in summaries)

    vectors = embeddings_client.embed(texts)
    if len(vectors) != len(texts):
        raise EmbeddingError("OpenAI returned a mismatched number of embeddings")

    offset = 0
    turn_vectors = vectors[offset : offset + len(turns)]
    offset += len(turns)
    thinking_vectors = vectors[offset : offset + len(thinking_turns)]
    offset += len(thinking_turns)
    summary_vectors = vectors[offset : offset + len(summaries)]

    turn_rows = [
        {
            "id": turn["id"],
            "conversation_id": conversation_id,
            "position": turn["position"],
            "user_text": turn["user"],
            "assistant_text": turn["assistant"],
            "content": _turn_content(turn),
            "embedding": format_vector(vector),
            "ts": turn["ts"],
        }
        for turn, vector in zip(turns, turn_vectors)
    ]
    thinking_rows = [
        {
            "id": turn["id"],
            "conversation_id": conversation_id,
            "position": turn["position"],
            "thinking": turn["thinking"],
            "embedding": format_vector(vector),
        }
        for turn, vector in zip(thinking_turns, thinking_vectors)
    ]
    summary_rows = [
        {
            "id": summary["id"],
            "conversation_id": summary["conversation_id"],
            "position": summary["position"],
            "summary": summary["summary"],
            "embedding": format_vector(vector),
        }
        for summary, vector in zip(summaries, summary_vectors)
    ]

    saved_turns = supabase_writer.upsert("chat_turns", turn_rows, on_conflict="id")
    saved_thinking = supabase_writer.upsert("chat_thinking", thinking_rows, on_conflict="id")
    saved_summaries = supabase_writer.upsert(
        "chat_summaries", summary_rows, on_conflict="conversation_id,position"
    )

    return {
        "saved_turns": saved_turns,
        "saved_thinking": saved_thinking,
        "saved_summaries": saved_summaries,
        "skipped_turns": skipped_turns,
        "skipped_thinking": skipped_thinking,
        "skipped_summaries": skipped_summaries,
    }
