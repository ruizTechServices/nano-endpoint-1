# Endpoint and application documentation analysis

The endpoint source-of-truth files under `orin-nano` were reviewed together with the archived upstream Qwen page under `qwen3`, the application-specific tool guide, and every repository Markdown file.

## Orin endpoint contract

- Base URL: `http://100.86.175.53:11435`
- Chat endpoint: `POST /api/chat`
- Required application model: `qwen3:1.7b`
- HTTP authentication: none documented; access depends on the private Tailscale network
- Required fields: `model`, `messages`, `messages[].role`, and `messages[].content`
- Supported message roles: `system`, `user`, and `assistant`
- Optional controls used here: `think`, `stream`, `keep_alive`, `tools`, `options.temperature`, `options.num_ctx`, and `options.num_predict`
- Non-streaming answer fields: `model`, `message.thinking`, `message.content`, `done`, `done_reason`, and `eval_count`
- Tool selection field: `message.tool_calls[]`, containing `function.name` and `function.arguments`
- Streaming mode: multiple JSON objects containing incremental `message.thinking` or `message.content`

The browser and CLI use non-streaming responses. The browser preserves endpoint thinking separately from the final response. When the model selects a tool, the browser executes one allowlisted local tool and deterministically formats its validated result without a second model rewrite.

## Model reference

The saved `qwen3/Qwen.html` page is an archival upstream Qwen reference and mentions the Qwen3 1.7B family and thinking/non-thinking modes. It is not the runtime endpoint contract and should not be edited to describe local application behavior. The exact deployed Ollama tag and HTTP behavior come from `orin-nano`, while `qwen3/tool-use.md` documents application prompting.

## Documented operating limits

- Thinking and final content share `num_predict`; a small budget can produce `done_reason:length` and an empty final answer.
- The endpoint must remain private and must not be exposed directly to public clients.
- The Orin Nano is intended for small local models; larger models are constrained by shared RAM, swap, thermals, and throughput.
- Ollama may reject sharded GGUF repositories.
- No concurrency, sustained-throughput, uptime, failover, queueing, or service-level guarantees are documented.
- Application tools are client-side capabilities, not autonomous internet or device access built into the Orin endpoint.

## Implemented applications

### Private CLI

The CLI supports bounded text summarization, rewriting, extraction, and questions. It uses typed validation, retries, structured rotating logs, and the fixed model.

### Orin Local browser chat

The browser application provides:

- Eight-slot context with 20-turn recursive summary consolidation.
- IndexedDB persistence and complete deletion.
- Collapsible endpoint thinking and safe Markdown output.
- `get_nyc_time`, `get_current_weather`, and `search_web` allowlisted tools.
- Deterministic formatting of authoritative tool fields.
- A loopback-only Python server that keeps the Brave credential out of browser code.

The browser still calls the private Orin endpoint directly and therefore remains a trusted-tailnet local application, not a public deployment architecture.
