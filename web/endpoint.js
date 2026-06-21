import { logger } from "./logger.js";
import { executeToolCall, formatToolResult, TOOL_DEFINITIONS } from "./tools.js";

export const ENDPOINT_URL = "http://100.86.175.53:11435/api/chat";
export const MODEL = "qwen3:1.7b";

const REQUEST_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;
const encoder = new TextEncoder();

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

async function request(type, messages, options, tools = null) {
  const requestId = crypto.randomUUID();
  const payload = {
    model: MODEL,
    think: type === "chat",
    stream: false,
    keep_alive: "10m",
    messages,
    options,
  };
  if (tools) payload.tools = tools;
  const body = JSON.stringify(payload);
  const payloadSize = encoder.encode(body).byteLength;
  let lastError;

  logger.info("endpoint.request", { type, requestId, model: MODEL, payloadSize, payload });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = performance.now();
    let status = 0;

    try {
      const response = await fetch(ENDPOINT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      status = response.status;
      const responseText = await response.text();
      const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;

      if (!response.ok) {
        const error = new Error(`Endpoint returned HTTP ${status}`);
        error.status = status;
        error.responseBody = responseText;
        throw error;
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error("Endpoint returned invalid JSON");
      }

      const content = data?.message?.content;
      if (data?.model !== MODEL || typeof content !== "string") {
        throw new Error("Endpoint response does not match the documented contract");
      }

      logger.info("endpoint.response", {
        type,
        requestId,
        model: MODEL,
        attempt,
        latencyMs,
        payloadSize,
        status,
        generatedTokens: data.eval_count ?? null,
        doneReason: data.done_reason ?? null,
        thinkingLength: data.message?.thinking?.length ?? 0,
        answerLength: content.length,
        response: data,
      });
      return {
        content: content.trim(),
        thinking: typeof data.message.thinking === "string" ? data.message.thinking.trim() : "",
        toolCalls: Array.isArray(data.message.tool_calls) ? data.message.tool_calls : [],
        message: data.message,
      };
    } catch (error) {
      const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
      lastError = error;
      const retryable = error.name === "AbortError" || status === 0 || isRetryableStatus(status);
      logger.error("endpoint.error", {
        type,
        requestId,
        model: MODEL,
        attempt,
        latencyMs,
        payloadSize,
        status,
        error: error.message,
        responseBody: error.responseBody ?? null,
        retryable,
      });

      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const delayMs = Math.min(500 * 2 ** (attempt - 1), 4_000);
      logger.warn("endpoint.retry", {
        type,
        requestId,
        model: MODEL,
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
      });
      await wait(delayMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`${type} request failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}`);
}

export async function chat(contextMessages, userMessage) {
  const messages = [...contextMessages, { role: "user", content: userMessage }];
  const options = {
    temperature: 0.2,
    num_ctx: 4096,
    num_predict: 2048,
  };

  const result = await request("chat", messages, options, TOOL_DEFINITIONS);
  if (result.toolCalls.length === 0) {
    if (!result.content) throw new Error("The model returned an empty chat response");
    return { content: result.content, thinking: result.thinking };
  }
  if (result.toolCalls.length !== 1) throw new Error("Expected exactly one allowlisted tool call");

  const toolResult = await executeToolCall(result.toolCalls[0]);
  return {
    content: formatToolResult(result.toolCalls[0], toolResult),
    thinking: result.thinking,
  };
}

export async function summarize(consolidationPayload) {
  const serialized = consolidationPayload
    .map((item) => {
      if (item.type === "summary") return `PRIOR SUMMARY:\n${item.content}`;
      return `USER:\n${item.user}\nASSISTANT:\n${item.assistant}`;
    })
    .join("\n\n---\n\n");
  const messages = [
    {
      role: "system",
      content:
        "Consolidate the supplied conversation memory. Preserve durable facts, preferences, decisions, open tasks, and corrections. Remove repetition and transient chatter. Do not invent information. Return only the consolidated memory.",
    },
    { role: "user", content: serialized },
  ];
  const result = await request("summarize", messages, {
    temperature: 0.1,
    num_ctx: 2048,
    num_predict: 512,
  });
  if (!result.content) throw new Error("The model returned an empty summary");
  return result.content;
}
