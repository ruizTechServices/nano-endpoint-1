# Orin Local browser chat

Orin Local is a framework-free browser application with a small Python standard-library server. It uses native ES modules with no bundler or build step. The server loads `web/index.html` at `/` and securely proxies Brave Search without exposing its credential to browser code.

## Start from Git Bash

Stop Live Server or any other process using port `5500`. From the repository root:

```bash
read -rsp "Brave API key: " BRAVE_SEARCH_API_KEY
echo
export BRAVE_SEARCH_API_KEY
python server.py
```

Open `http://127.0.0.1:5500/`. Using the same host and port as the previous Live Server setup preserves access to the existing origin-scoped IndexedDB history. Stop with `Ctrl+C`; then run `unset BRAVE_SEARCH_API_KEY` to remove the session credential.

The server deliberately reads the credential only from its inherited process environment. It binds to a loopback IP and rejects non-loopback binding.

## Endpoint behavior

Chat and summary calls use the documented private endpoint:

```text
POST http://100.86.175.53:11435/api/chat
model: qwen3:1.7b
```

Chat is non-streaming with `think:true`, `num_ctx:4096`, and `num_predict:2048`. The UI renders `message.thinking` in a collapsed disclosure and `message.content` as safe Markdown. Summary calls use `think:false`, `num_ctx:2048`, and `num_predict:512`.

The browser calls the Orin endpoint directly. This is acceptable only for a trusted local client on the private tailnet. The Orin endpoint must allow the `http://127.0.0.1:5500` origin. Do not expose this architecture as a public web application.

## Persistent memory

State is stored in IndexedDB database `orin-local-chat`, store `state`, under three keys:

- `history`
- `rollingSummary`
- `interactionCount`

Memory uses eight context slots:

- Before a summary exists: up to eight raw interactions.
- After a summary exists: one pinned summary plus the latest seven raw interactions.
- Every 20 interactions: recursively consolidate the previous summary and latest 20 raw interactions.
- Summary failure: keep the previous summary and continue chatting.
- **Delete all**: clear all three persisted values and reset the UI.

## Tools

The model receives exactly three allowlisted function definitions:

- `get_nyc_time`: no arguments; fixed TimeAPI.io request for `America/New_York`.
- `get_current_weather`: one `location` string; Open-Meteo geocoding and current conditions.
- `search_web`: one `query` string; same-origin Python proxy to Brave Web Search.

The tool dispatcher rejects unknown names and unexpected arguments. Validated tool fields are formatted deterministically by the frontend rather than rewritten by the model. See the complete [tool prompting guide](../qwen3/tool-use.md).

## Brave proxy security

`POST /api/brave-search` is the only local API route. The proxy provides:

- A fixed Brave Web Search HTTPS destination.
- `X-Subscription-Token` added only on the server.
- JSON content-type and 8 KiB body limits.
- Search queries limited to 2–400 printable characters.
- Result counts limited to 1–10; the frontend requests five.
- Per-client sliding-window rate limiting, 30 requests per 60 seconds.
- Validation of result shapes and HTTP/HTTPS URLs.
- No-cache API responses and restrictive browser security headers.
- Structured metadata logs that omit credentials, query text, and bodies.

The credential is never returned to frontend JavaScript, persisted in IndexedDB, included in model messages, or written to application logs.

## Verification

From the repository root, run Python tests:

```bash
PYTHONPATH='src:.' python -m unittest discover -s tests -v
```

Run JavaScript tests:

```bash
node --test web/tests/*.test.mjs
```

On Windows with Chrome installed, the rendered end-to-end smoke test is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\web\tests\browser-ui-smoke.ps1
```

The browser smoke test exercises tool rendering, thinking, Markdown safety, reload persistence, delete behavior, and the IndexedDB wipe. Its Brave response is deterministic test data; it does not prove live Brave authentication.
