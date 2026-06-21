# Production viability assessment

## Verdict

**Not viable for production use with real external users in the current architecture.** The CLI and browser chat are viable as private, best-effort local utilities on the trusted tailnet.

## Evidence

Observed on 2026-06-21:

- Live Orin contract smoke test passed against `qwen3:1.7b`: 5 generated tokens, `done_reason:stop`, and 3.54 seconds latency.
- A three-request warm sequential benchmark succeeded 3/3, with 442–866 ms latency for four generated tokens.
- A real CLI summary succeeded with 16 generated tokens and `done_reason:stop` in 3.96 seconds; the endpoint reported roughly 3.04 seconds of model load time.
- Current Python suite: 17 deterministic tests passed; one live endpoint test remains intentionally opt-in.
- Current JavaScript suite: 24 tests passed, covering endpoint payloads, memory, logging, all three tools, authoritative formatting, and failure handling.
- Rendered Chrome smoke test passed tool rendering, thinking display, safe Markdown, reload persistence, delete behavior, and IndexedDB clearing with zero runtime exceptions. Its Brave response was deterministic test data, so it does not establish live Brave availability.

These measurements prove functional integration, not production capacity. The endpoint measurements are small and sequential and do not establish concurrency, tail latency, sustained throughput, or uptime.

## Current security boundary

- The Orin Ollama endpoint uses plain HTTP inside the private tailnet and has no documented application authentication.
- The browser calls Orin directly and is therefore suitable only for a trusted local client connected to that tailnet.
- Brave Search is safer: browser requests go to a loopback-only Python proxy, and the credential stays server-side.
- Time and weather use credential-free public HTTPS APIs directly from the browser.
- CLI logs can contain complete prompts and responses and must remain private; `logs/` is excluded from Git.
- Local environment credential files, virtual environments, caches, and logs are excluded from Git.

## Blocking production issues

1. **Single point of failure:** one Jetson, Docker container, Ollama process, and private-network path have no failover.
2. **No production service boundary for inference:** there is no authenticated server-side gateway, authorization, tenant isolation, queue, or production-grade distributed rate limit in front of Orin.
3. **Capacity is unproven:** a small edge device with shared memory cannot support a defensible multi-user service-level objective without load and soak testing.
4. **Model capability:** the 1.7B model is useful for bounded tasks but has no task-specific quality evaluation supporting high-stakes or monetized use.
5. **Browser architecture:** direct browser-to-Orin access depends on tailnet membership and CORS and cannot be safely opened to public users.
6. **External-tool reliability:** Brave, TimeAPI.io, and Open-Meteo add availability and quota dependencies; only local validation and error handling are implemented.
7. **No business evidence:** no validated user segment, willingness-to-pay result, accuracy target, or cost/capacity model exists.
8. **Operations are manual:** container restarts, GPU monitoring, thermals, memory pressure, and model availability rely on manual checks.

## Decision

Do not publicly expose or monetize this deployment. Keep it local, collect task-quality and reliability evidence, and treat all tool output as informational. No speculative production database, public auth provider, hosted API, or paid-service scaffold is justified by the current evidence.

Before reconsidering production, require an authenticated server-side inference gateway, encrypted transport, per-user authorization and quotas, durable request auditing with redaction, health checks, queueing, concurrency and soak tests, failover strategy, tool-provider quota monitoring, task-specific quality evaluation, and validated user demand.
