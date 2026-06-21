# Orin Private Text Utility — Pseudocode

## Startup

```text
parse CLI arguments: operation, input text/stdin, generation controls
load runtime settings with the documented endpoint and fixed qwen3:1.7b model
configure rotating JSON-file logging
create endpoint client
create text-assistant service around the client
```

## Request flow

```text
CLI receives one of: summarize, rewrite, extract, ask
CLI obtains text from an argument or standard input
CLI validates that text is present

service selects the operation-specific system instruction
service creates system and user messages
service asks endpoint client for a non-streaming completion

client:
    reject any model other than qwen3:1.7b
    construct the documented Ollama /api/chat payload
    generate request and correlation identifiers
    log the complete request payload as structured JSON
    start a monotonic latency timer

    for each allowed attempt:
        issue HTTP POST with application/json
        if response is retryable (429 or 5xx, timeout, connection failure):
            log structured retry metadata
            wait using bounded exponential backoff with jitter
            continue
        if response is a non-retryable HTTP error:
            log status, latency, and response body
            raise a typed endpoint error
        parse JSON and validate the documented response fields
        log status, latency, done reason, and eval_count token usage
        return a typed completion result

    raise a typed retry-exhausted error

service checks for truncated or empty output
service returns the final answer and inference metadata
CLI prints the answer to stdout
CLI optionally prints metadata as JSON to stderr
CLI maps typed failures to stable exit codes without printing stack traces
```

## Verification

```text
unit tests:
    assert the fixed model and documented payload shape
    assert response parsing and token extraction
    assert retry behavior for transient failures
    assert no retry for permanent failures
    assert operation-specific prompt construction

live smoke test:
    send an exact-response prompt with think=false and deterministic options
    assert HTTP success, qwen3:1.7b response model, non-empty answer, and done=true
    print machine-readable latency and token evidence
```

## Production assessment

```text
run repeated endpoint requests
record success rate and latency
combine measurements with documented network, hardware, security, and model limits
evaluate reliability, concurrency, user value, and operating economics

if evidence does not support production:
    state the verdict and do not scaffold speculative paid infrastructure
else:
    list approved external dependencies and credentials
    scaffold API boundary, authentication, persistence, rate limiting, and errors
```
