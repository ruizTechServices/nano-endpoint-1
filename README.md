# Orin Nano Qwen3 Utilities

Private local applications for the documented Jetson Orin Nano Ollama endpoint. Every inference request is fixed to `qwen3:1.7b`; no larger model is substituted.

The repository contains:

- A Python CLI for summarization, rewriting, extraction, and direct questions.
- A framework-free browser chat with IndexedDB history, rolling-summary memory, visible endpoint thinking, safe Markdown, current-time and weather tools, and Brave web search through a secure local Python proxy.

## Browser chat

The browser app is the primary interactive interface. Stop any server already using port `5500`, then run this from Git Bash at the repository root:

```bash
read -rsp "Brave API key: " BRAVE_SEARCH_API_KEY
echo
export BRAVE_SEARCH_API_KEY
python server.py
```

Open `http://127.0.0.1:5500/`. Stop the server with `Ctrl+C`, then remove the session credential with:

```bash
unset BRAVE_SEARCH_API_KEY
```

The server binds only to loopback, serves `web/index.html` at `/`, and exposes only `POST /api/brave-search`. The Brave credential remains server-side. The page calls the private Orin endpoint directly, so the browser must be on the same trusted tailnet and the endpoint must allow the page origin.

Browser memory uses eight slots. Before the first summary, it includes up to eight raw interactions. Afterward, one pinned summary plus the latest seven raw interactions occupy those slots. Consolidation runs every 20 interactions and failures do not interrupt chat. The **Delete all** control removes history, summary, and counter from IndexedDB.

Detailed browser usage and tool prompting:

- [Browser application guide](web/README.md)
- [Qwen3 tool-use guide](qwen3/tool-use.md)

## CLI

Run directly from PowerShell:

```powershell
$env:PYTHONPATH='src'
python -m orin_text summarize 'Text to summarize'
python -m orin_text rewrite 'Text to rewrite'
python -m orin_text extract 'Meeting notes'
python -m orin_text ask 'Explain this error'
```

From Git Bash:

```bash
PYTHONPATH=src python -m orin_text ask 'Explain this error'
```

Omit the text argument to read from standard input. Add `--metadata` to emit request ID, latency, model, generated-token count, and completion reason to standard error. `--think` enables thinking mode and enforces the documented minimum 1024-token output budget.

## Architecture

- `server.py`: loopback-only static server and Brave proxy startup
- `proxy/`: Brave client, request validation, rate limiting, and structured server logging
- `web/`: IndexedDB chat, endpoint client, tool dispatcher, memory, UI, and safe Markdown
- `src/orin_text/client.py`: CLI endpoint contract, retries, timing, and response validation
- `src/orin_text/service.py`: CLI operation-specific business rules
- `src/orin_text/logging_config.py`: rotating structured JSON logs
- `src/orin_text/cli.py`: CLI argument parsing, output, and exit codes

CLI logs are JSON Lines in `logs/orin-text.jsonl`, rotated daily and retained for 14 rotations. They may contain complete request and response payloads, so `logs/` is excluded from Git and should remain private.

## Verification

Run all Python tests from PowerShell:

```powershell
$env:PYTHONPATH='src;.'
python -m unittest discover -s tests -v
```

Or from Git Bash:

```bash
PYTHONPATH='src:.' python -m unittest discover -s tests -v
```

Run browser module tests:

```bash
node --test web/tests/*.test.mjs
```

On Windows with Chrome installed, run the rendered smoke test while an appropriate local test server is available:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\web\tests\browser-ui-smoke.ps1
```

The live Orin test is intentionally opt-in:

```powershell
$env:PYTHONPATH='src;.'
$env:RUN_LIVE_SMOKE_TEST='1'
python -m unittest tests.test_live_endpoint -v
```

## Documentation

- [Endpoint analysis](DOCS_ANALYSIS.md)
- [CLI pseudocode](PSEUDOCODE.md)
- [Browser pseudocode](web/PSEUDOCODE.md)
- [Production assessment](PRODUCTION_ASSESSMENT.md)
- [Orin endpoint contract](orin-nano/docs.md)
- [Orin operations cheat sheet](orin-nano/cheat-sheet.md)
- [Tool prompting guide](qwen3/tool-use.md)
- [GitHub publishing guide](GITHUB_PUSH.md)

The archived upstream Qwen page under `qwen3/` is reference material. Application behavior is defined by this repository and the Orin endpoint documentation.
