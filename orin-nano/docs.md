# ENDPOINT_DOCS.md — Orin Nano Ollama API Docs

## Base URL

```text
http://100.86.175.53:11435
```

## Main Endpoint

```text
POST /api/chat
```

Full URL:

```text
http://100.86.175.53:11435/api/chat
```

## Purpose

This endpoint sends chat messages to the Ollama server running inside the `ollama-gpu` Docker container on the Jetson Orin Nano.

It can be used by:

* terminal curl commands
* local scripts
* Next.js API routes
* internal development tools
* local AI chat interfaces
* ruizTechStudio experiments

## Request Shape

```json
{
  "model": "qwen3:1.7b",
  "think": true,
  "stream": false,
  "messages": [
    {
      "role": "user",
      "content": "Explain recursion simply."
    }
  ],
  "keep_alive": "10m",
  "options": {
    "temperature": 0.2,
    "num_ctx": 2048,
    "num_predict": 1024
  }
}
```

## Required Fields

| Field                | Type   | Purpose                          |
| -------------------- | ------ | -------------------------------- |
| `model`              | string | Model name, usually `qwen3:1.7b` |
| `messages`           | array  | Chat history                     |
| `messages[].role`    | string | `system`, `user`, or `assistant` |
| `messages[].content` | string | Message text                     |

## Useful Optional Fields

| Field                 | Type    | Purpose                                                            |
| --------------------- | ------- | ------------------------------------------------------------------ |
| `think`               | boolean | Enables separate model thinking output                             |
| `stream`              | boolean | Streams chunks when `true`; returns one JSON response when `false` |
| `keep_alive`          | string  | Keeps model loaded after request                                   |
| `tools`               | array   | Ollama function definitions the model may select                   |
| `options.temperature` | number  | Controls randomness                                                |
| `options.num_ctx`     | number  | Context window                                                     |
| `options.num_predict` | number  | Maximum generated output tokens                                    |

## Recommended Option Presets

### Preset 1: Basic Fast Chat

Use for quick assistant answers.

```json
{
  "model": "qwen3:1.7b",
  "think": false,
  "stream": false,
  "keep_alive": "10m",
  "options": {
    "temperature": 0.2,
    "num_ctx": 2048,
    "num_predict": 512
  }
}
```

### Preset 2: Thinking Chat

Use when you want to see reasoning.

```json
{
  "model": "qwen3:1.7b",
  "think": true,
  "stream": false,
  "keep_alive": "10m",
  "options": {
    "temperature": 0.2,
    "num_ctx": 2048,
    "num_predict": 1024
  }
}
```

### Preset 3: Frontend Streaming Chat

Use for a Next.js UI where thinking and answer appear live.

```json
{
  "model": "qwen3:1.7b",
  "think": true,
  "stream": true,
  "keep_alive": "10m",
  "options": {
    "temperature": 0.2,
    "num_ctx": 2048,
    "num_predict": 1024
  }
}
```

### Preset 4: Exact Reply Test

Use for endpoint checks.

```json
{
  "model": "qwen3:1.7b",
  "think": false,
  "stream": false,
  "keep_alive": "10m",
  "messages": [
    {
      "role": "user",
      "content": "Reply with exactly: orin endpoint online"
    }
  ],
  "options": {
    "temperature": 0,
    "num_ctx": 1024,
    "num_predict": 32
  }
}
```

Important: exact reply tests should usually use `think:false`.

## Non-Streaming Response Shape

With `stream:false`:

```json
{
  "model": "qwen3:1.7b",
  "created_at": "...",
  "message": {
    "role": "assistant",
    "thinking": "...",
    "content": "..."
  },
  "done": true,
  "done_reason": "stop",
  "eval_count": 123
}
```

Important fields:

| Field              | Meaning                                   |
| ------------------ | ----------------------------------------- |
| `message.thinking` | Reasoning/thinking text when `think:true` |
| `message.content`  | Final answer                              |
| `done`             | Whether generation finished               |
| `done_reason`      | Why generation stopped                    |
| `eval_count`       | Number of generated tokens                |

When a tool is selected, `message.tool_calls` may be present instead of a normal final answer:

```json
{
  "model": "qwen3:1.7b",
  "message": {
    "role": "assistant",
    "thinking": "...",
    "content": "",
    "tool_calls": [
      {
        "function": {
          "name": "get_current_weather",
          "arguments": {
            "location": "Boston, Massachusetts, United States"
          }
        }
      }
    ]
  },
  "done": true
}
```

`message.tool_calls` is a selection request, not an executed result. The client must allowlist the function, validate its arguments, perform the external operation, and validate the returned data.

## Orin Local tool definitions

The current browser application supplies three function definitions:

| Tool | Arguments | Execution location |
|---|---|---|
| `get_nyc_time` | none | Browser to fixed TimeAPI.io endpoint |
| `get_current_weather` | `location` string | Browser to fixed Open-Meteo endpoints |
| `search_web` | `query` string | Browser to loopback Python proxy, then fixed Brave Search endpoint |

These functions are implemented by Orin Local. They do not grant arbitrary network, shell, filesystem, or device access to Qwen or Ollama. Validated results are formatted deterministically without a second model rewrite. Prompting details are in [`../qwen3/tool-use.md`](../qwen3/tool-use.md).

## `done_reason`

Common meanings:

| Value         | Meaning                       |
| ------------- | ----------------------------- |
| `stop`        | Model finished normally       |
| `length`      | Model hit `num_predict` limit |
| unknown/other | Inspect raw response          |

If you see:

```json
"done_reason": "length"
```

and:

```json
"message": {
  "thinking": "...",
  "content": ""
}
```

then the model spent the output budget on thinking and never reached the final answer.

Fix it by increasing:

```json
"num_predict": 1024
```

or by telling the model:

```text
Think briefly, then answer...
```

## Curl Examples

### Health Check

```bash
curl -sS http://100.86.175.53:11435/api/tags | jq
```

### Basic Chat

```bash
curl -sS http://100.86.175.53:11435/api/chat \
  -H "Content-Type: application/json" \
  --data-raw '{
    "model":"qwen3:1.7b",
    "think":false,
    "stream":false,
    "messages":[
      {
        "role":"user",
        "content":"Explain what an algorithm is in one paragraph."
      }
    ],
    "keep_alive":"10m",
    "options":{
      "temperature":0.2,
      "num_ctx":2048,
      "num_predict":512
    }
  }' | jq -r '.message.content // .error // .'
```

### Thinking Chat

```bash
curl -sS http://100.86.175.53:11435/api/chat \
  -H "Content-Type: application/json" \
  --data-raw '{
    "model":"qwen3:1.7b",
    "think":true,
    "stream":false,
    "messages":[
      {
        "role":"user",
        "content":"Think briefly, then explain recursion simply in one paragraph."
      }
    ],
    "keep_alive":"10m",
    "options":{
      "temperature":0.2,
      "num_ctx":2048,
      "num_predict":1024
    }
  }' \
  | jq -r '"THINKING:\n\(.message.thinking // "")\n\nANSWER:\n\(.message.content // "")"'
```

### Debug Full JSON

```bash
curl -sS http://100.86.175.53:11435/api/chat \
  -H "Content-Type: application/json" \
  --data-raw '{
    "model":"qwen3:1.7b",
    "think":true,
    "stream":false,
    "messages":[
      {
        "role":"user",
        "content":"Explain recursion simply."
      }
    ],
    "options":{
      "temperature":0.2,
      "num_ctx":2048,
      "num_predict":512
    }
  }' | jq .
```

### Debug Only Important Fields

```bash
curl -sS http://100.86.175.53:11435/api/chat \
  -H "Content-Type: application/json" \
  --data-raw '{
    "model":"qwen3:1.7b",
    "think":true,
    "stream":false,
    "messages":[
      {
        "role":"user",
        "content":"Explain recursion simply."
      }
    ],
    "options":{
      "temperature":0.2,
      "num_ctx":2048,
      "num_predict":512
    }
  }' | jq '{
    thinking:.message.thinking,
    answer:.message.content,
    done:.done,
    done_reason:.done_reason,
    eval_count:.eval_count
  }'
```

## Streaming Response Handling

With:

```json
"stream": true
```

Ollama returns multiple JSON objects, one per chunk.

Each chunk can contain:

```json
{
  "message": {
    "thinking": "..."
  }
}
```

or:

```json
{
  "message": {
    "content": "..."
  }
}
```

Terminal streaming example:

```bash
curl -sS http://100.86.175.53:11435/api/chat \
  -H "Content-Type: application/json" \
  --data-raw '{
    "model":"qwen3:1.7b",
    "think":true,
    "stream":true,
    "messages":[
      {
        "role":"user",
        "content":"Think briefly, then explain recursion simply in one paragraph."
      }
    ],
    "options":{
      "temperature":0.2,
      "num_ctx":2048,
      "num_predict":1024
    }
  }' \
  | jq -r '
    if .message.thinking then "[thinking] " + .message.thinking
    elif .message.content then "[answer] " + .message.content
    else empty end
  '
```

## Next.js Integration

Do not expose the Orin endpoint directly to public client-side code.

The current Orin Local browser is a separate trusted-tailnet local use case. It calls Orin directly and uses a loopback-only Python server solely for the credentialed Brave Search tool. Do not deploy that local arrangement to public users.

Use this architecture:

```text
Browser
  -> /api/local-ai/chat
    -> http://100.86.175.53:11435/api/chat
      -> Ollama Docker container
```

### Minimal Non-Streaming API Route

File:

```text
app/api/local-ai/chat/route.ts
```

Code:

```ts
export async function POST(req: Request) {
  const body = await req.json();

  const response = await fetch("http://100.86.175.53:11435/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen3:1.7b",
      think: true,
      stream: false,
      keep_alive: "10m",
      messages: body.messages,
      options: {
        temperature: 0.2,
        num_ctx: 2048,
        num_predict: 1024,
      },
    }),
  });

  if (!response.ok) {
    return Response.json(
      {
        error: "Ollama request failed",
        status: response.status,
        details: await response.text(),
      },
      { status: 502 }
    );
  }

  const data = await response.json();

  return Response.json({
    thinking: data.message?.thinking ?? "",
    answer: data.message?.content ?? "",
    done: data.done ?? false,
    doneReason: data.done_reason ?? null,
    raw: data,
  });
}
```

### Minimal Frontend Fetch

```ts
const response = await fetch("/api/local-ai/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    messages: [
      {
        role: "user",
        content: "Think briefly, then explain recursion simply.",
      },
    ],
  }),
});

const data = await response.json();

console.log("Thinking:", data.thinking);
console.log("Answer:", data.answer);
```

## Frontend UI Recommendation

Render thinking and answer separately:

```text
AI Thinking
-----------
data.thinking

Final Answer
------------
data.answer
```

For a production UI, make the thinking panel collapsible.

## Troubleshooting

### Empty Answer

Problem:

```json
{
  "message": {
    "thinking": "...",
    "content": ""
  },
  "done_reason": "length"
}
```

Cause:

```text
The model used all output tokens on thinking.
```

Fix:

```json
"num_predict": 1024
```

or:

```text
Think briefly, then answer...
```

### Exact Reply Test Returns Blank

Cause:

```text
Thinking mode used too much token budget.
```

Fix:

```json
"think": false
```

for exact-output tests.

### Server Unreachable

Check:

```bash
docker ps
```

Then:

```bash
docker restart ollama-gpu
```

Then test:

```bash
curl -sS http://100.86.175.53:11435/api/tags | jq
```

### Slow Responses

Check:

```bash
jtop
```

Look at:

* GPU usage
* RAM usage
* swap usage
* temperature
* power mode

If swap is high, use a smaller model or lower `num_ctx`.

### Model Not Found

List installed models:

```bash
docker exec -it ollama-gpu ollama list
```

Pull model:

```bash
docker exec -it ollama-gpu ollama pull qwen3:1.7b
```

## TL;DR

Use `/api/chat` with `model:"qwen3:1.7b"`.

Use `think:true` to get `message.thinking`.

Use `message.content` for the final answer.

Use `num_predict:1024` when thinking is enabled.

For public applications, use an authenticated server-side gateway such as a Next.js API route. For the local Orin Local app, use `python server.py` on loopback and keep the browser on the trusted tailnet.
