# Cloud Save — Conversation History to Supabase pgvector

This document describes the **"Save to cloud"** feature added to Orin Local: a button that
snapshots the browser chat history into a Supabase Postgres database, embedding each turn so the
conversation becomes semantically searchable later.

It is **opt-in** and additive. The local-first design is unchanged — IndexedDB remains the source
of truth for the live chat; cloud save is a separate, deliberate export on top of it.

---

## 1. Goal

- A header button that pushes the *currently loaded* conversation to the cloud on demand.
- Each turn stored with: a conversation id, its position in the conversation, the text, and a
  1536-dim embedding.
- Thinking stored separately (and embedded) to future-proof a planned **"dreaming"** function.
- Rolling-summary checkpoints stored separately (and embedded).
- Re-saving must be idempotent and must not waste money re-embedding unchanged turns.

---

## 2. Architecture

```text
Browser (IndexedDB = source of truth)
   │  click "Save to cloud"
   ▼
web/save.js  ── POST /api/save-history (same-origin) ──►  Python server (server.py + proxy/)
                                                              │
                                  ┌───────────────────────────┼───────────────────────────┐
                                  ▼                           ▼                           ▼
                          existing_positions()        OpenAI embeddings           Supabase upsert
                          (skip already-saved)      text-embedding-3-small        (service-role key,
                                                        → vector(1536)             PostgREST REST API)
```

Key properties:

- **Secrets stay server-side.** The browser only talks to the same-origin Python server. The
  OpenAI key and the Supabase service-role key never reach the browser. No CSP change was needed
  (`connect-src 'self'` already covers `/api/save-history`).
- **Dependency-free.** OpenAI and Supabase are called with the Python standard library
  (`urllib.request`), mirroring the existing `BraveSearchClient`. No new PyPI packages.

---

## 3. Database schema (Supabase project `orin-nano-chatbot`)

Applied as migration `orin_chat_history_pgvector`. All three tables have `embedding vector(1536)`
and RLS enabled (the service-role key bypasses RLS; the anon key has no access).

```sql
create extension if not exists vector;

create table public.chat_turns (
  id              uuid primary key,                 -- the turn's stable UUID
  conversation_id bigint       not null,            -- durable delete-counter value
  position        integer      not null,            -- 0-based index in history
  user_text       text         not null,
  assistant_text  text         not null,
  content         text         not null,            -- embedded "USER:..\nASSISTANT:.." text
  embedding       vector(1536) not null,
  ts              timestamptz,
  created_at      timestamptz  not null default now(),
  unique (conversation_id, position)
);

create table public.chat_thinking (
  id              uuid primary key                  -- = the turn's UUID (1:1, cascade)
                    references public.chat_turns(id) on delete cascade,
  conversation_id bigint       not null,
  position        integer      not null,            -- same position as the parent turn
  thinking        text         not null,
  embedding       vector(1536) not null,
  created_at      timestamptz  not null default now(),
  unique (conversation_id, position)
);

create table public.chat_summaries (
  id              uuid primary key,
  conversation_id bigint       not null,
  position        integer      not null,            -- interactionCount when summarized (× 20)
  summary         text         not null,
  embedding       vector(1536) not null,
  created_at      timestamptz  not null default now(),
  unique (conversation_id, position)
);

create index on public.chat_turns     using hnsw (embedding vector_cosine_ops);
create index on public.chat_thinking  using hnsw (embedding vector_cosine_ops);
create index on public.chat_summaries using hnsw (embedding vector_cosine_ops);
create index on public.chat_turns (conversation_id, position);

alter table public.chat_turns     enable row level security;
alter table public.chat_thinking  enable row level security;
alter table public.chat_summaries enable row level security;
```

**Why `chat_thinking` is its own embedded table:** all three tables share the same
`(conversation_id, position)` addressing, so a future **"dreaming"** function can interlope /
join `chat_thinking` with `chat_summaries` cleanly. Deleting a turn cascades to its thinking row.

---

## 4. Core algorithms

### 4.1 Durable conversation id (the "delete counter")

The conversation id is an integer that **survives "Delete all"** and increments on each delete.

- Stored in a dedicated IndexedDB object store, **`meta`** (DB version bumped 1 → 2). `clear()`
  only wipes the `state` store, so the counter is never reset by a delete.
- Starts at **0**. `deleteAll()` reads the counter, writes `counter + 1` to `meta` **first**, then
  clears the conversation data. The new empty conversation therefore has the next id.
- `Save to cloud` stamps every row with the current counter value.

```text
meta.conversationId : integer, default 0  (survives "Delete all")

Save():   stamp every row with conversation_id = meta.conversationId
Delete(): meta.conversationId += 1  (persisted BEFORE wiping the state store)
```

First conversation = 0; after the 1st delete = 1; after the 2nd = 2; and so on.

### 4.2 Summary logging (capture every checkpoint)

The app keeps only the latest recursive `rollingSummary` (each consolidation overwrites the
previous). To preserve every checkpoint:

- On each consolidation (every 20 interactions), an entry is appended to a durable **`summaryLog`**
  array in IndexedDB: `{ id, conversationId, position: interactionCount, summary, ts }`.
- At save time, if `summaryLog` is empty but a `rollingSummary` exists (a conversation that
  predates logging), one entry is **back-filled** at its computed position
  (`floor(interactionCount / 20) * 20`).

### 4.3 Idempotent save + skip-already-saved (no re-embedding waste)

Saving is a **sync**, not an append. Re-saving never duplicates rows and never re-embeds
unchanged turns:

- Before embedding, the server calls `existing_positions(table, conversation_id)` for each table
  and **skips** any `(conversation_id, position)` already stored.
- Only genuinely new rows are embedded (the paid OpenAI call) and upserted.
- This is safe because a turn's content is immutable once created (no edit feature) and
  "Delete all" mints a new conversation id — so an existing `(conversation_id, position)` is
  guaranteed unchanged.
- Upsert conflict targets: `chat_turns` and `chat_thinking` on `id`; `chat_summaries` on
  `(conversation_id, position)`. `Prefer: resolution=merge-duplicates`.

Result reported back to the UI: `saved_turns / saved_thinking / saved_summaries` plus
`skipped_*`. An unchanged re-save → "Already up to date".

---

## 5. Request flow & validation

- Endpoint: `POST /api/save-history` (loopback only, same-origin).
- Body cap: `MAX_SAVE_BODY_BYTES = 2 MiB` (separate from the 8 KiB Brave cap).
- `validate_save_payload()` enforces: known fields only, `conversationId >= 0`, per-turn/summary
  field types and length caps, non-empty save.
- If cloud save is **not configured** (any of the three secrets missing) the route returns
  `503 "Cloud save is not configured"` and the rest of the app keeps working.
- Errors are mapped to safe messages (`EmbeddingError` / `SupabaseError` → `502`); credentials and
  embeddings are never logged.

---

## 6. Configuration & running

Cloud save needs three env vars (in addition to `BRAVE_SEARCH_API_KEY`). They live in
`.env.local` (gitignored) and are loaded into the server process:

```
OPENAI_API_KEY=...
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...        # server-only; bypasses RLS by design
```

Run the server from the repo root (Git Bash) — `set -a; source` loads all four at once:

```bash
set -a; source .env.local; set +a
python server.py
```

The startup log line includes `"cloud_save": true` when the credentials were picked up. These
secrets are **optional**: without them the app still runs and the save route returns 503.

---

## 7. Caching fix (static assets)

The plain `http.server` did not send cache headers, so browsers could serve **stale JS** after an
update (this caused an early "Save button does nothing"). The server now sends
`Cache-Control: no-store` on **every** response (a single source of truth in `end_headers`), so
updated JS/CSS is always fetched fresh.

---

## 8. Files

### New

| File | Purpose |
| --- | --- |
| `web/save.js` | Builds the save payload from persisted state; POSTs `/api/save-history`. |
| `proxy/embeddings_client.py` | Stdlib OpenAI embeddings client (`text-embedding-3-small`). |
| `proxy/supabase_client.py` | Stdlib Supabase REST client: `upsert`, `existing_positions`, `format_vector`. |
| `proxy/save_service.py` | Orchestration: skip-existing → embed new → upsert three tables. |
| `tests/test_save.py` | Unit tests for clients, validation, orchestration, and the route. |
| `web/tests/save.test.mjs` | Unit tests for payload building, summary back-fill, position math. |

### Modified

| File | Change |
| --- | --- |
| `web/db.js` | DB v2: `meta` store + `conversationId` helpers; `summaryLog` key; extended `loadState`. |
| `web/chat.js` | Loads/wires `conversationId` + `summaryLog`; logs summaries; delete bumps the counter. |
| `web/ui.js` | "Save to cloud" button handler + status line ("Saved N new…" / "Already up to date"). |
| `web/index.html` | Save button in the header + a save-status element. |
| `web/styles.css` | `.header-actions` and `.save-status` styles. |
| `proxy/app.py` | `/api/save-history` route; parametrized body reader; client wiring; `no-store` header. |
| `proxy/security.py` | `MAX_SAVE_BODY_BYTES` + `validate_save_payload` and helpers. |
| `server.py` | Loads the three optional secrets and constructs the clients. |

---

## 9. Testing

- **Python:** 38 tests pass (1 opt-in live test skipped). Includes embeddings/Supabase clients
  (with injected fake openers — no real network), validation, the orchestration skip-logic, and
  the HTTP route (happy path, unsupported fields, wrong method, unconfigured 503).
- **Web:** 29 tests pass, including payload building, summary back-fill, and position math.
- **Real integration verified:** an end-to-end write through the real OpenAI key and the
  `orin-nano-chatbot` Supabase project produced correctly aligned rows with 1536-dim vectors; a
  re-save returned `saved: 0` (skip working) with the original rows untouched.

```bash
# Python
PYTHONPATH='src;.' python -m unittest discover -s tests -v   # PowerShell uses ';'
# Web
node --test web/tests/*.test.mjs
```

---

## 10. Cost & behavior summary

| Action | Result |
| --- | --- |
| Save (first time) | Embeds + stores every turn / thinking / summary once. |
| Re-save, nothing new | 0 OpenAI calls, 0 writes → "Already up to date". |
| Continue chatting, then save | Only the new turns are embedded + inserted. |
| Save → "Delete all" → chat → save | New conversation id; everything embedded once under the new id. |

Embeddings model `text-embedding-3-small` costs ≈ $0.02 / 1M tokens, and re-embedding is now
avoided entirely for unchanged turns.

---

## 11. Out of scope / future

- **Retrieval/search UI** — this feature only *writes* vectors. A `/api/search-history` cosine-match
  route is an easy follow-up.
- **"Dreaming" function** — the schema is ready (`chat_thinking` ⨝ `chat_summaries` via
  `(conversation_id, position)`); the function itself is not implemented here.
- Summaries created *before* this feature existed were already overwritten and are unrecoverable;
  the current one is captured and all future checkpoints are logged.
