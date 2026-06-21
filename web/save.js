import * as database from "./db.js";
import { logger } from "./logger.js";
import { SUMMARIZE_EVERY } from "./summary.js";

export const SAVE_URL = "/api/save-history";

function turnRows(history) {
  return history.map((interaction, index) => ({
    id: interaction.id,
    position: index,
    user: interaction.user,
    assistant: interaction.assistant,
    thinking: typeof interaction.thinking === "string" ? interaction.thinking : "",
    ts: interaction.ts ?? null,
  }));
}

export function buildSummaryRows(summaryLog, rollingSummary, interactionCount, conversationId) {
  if (Array.isArray(summaryLog) && summaryLog.length > 0) {
    return summaryLog.map((entry) => ({
      id: entry.id,
      conversationId: Number.isInteger(entry.conversationId) ? entry.conversationId : conversationId,
      position: entry.position,
      summary: entry.summary,
      ts: entry.ts ?? null,
    }));
  }
  // Back-fill: this conversation predates summary logging, but a rolling summary still exists.
  // Capture it once at the turn it was last consolidated (the largest multiple of SUMMARIZE_EVERY).
  if (rollingSummary) {
    return [
      {
        id: crypto.randomUUID(),
        conversationId,
        position: Math.floor(interactionCount / SUMMARIZE_EVERY) * SUMMARIZE_EVERY,
        summary: rollingSummary,
        ts: null,
      },
    ];
  }
  return [];
}

export function buildSavePayload(state) {
  const { history, rollingSummary, interactionCount, summaryLog, conversationId } = state;
  return {
    conversationId,
    turns: turnRows(Array.isArray(history) ? history : []),
    summaries: buildSummaryRows(summaryLog, rollingSummary, interactionCount, conversationId),
  };
}

export async function saveHistory(fetchImpl = fetch) {
  const state = await database.loadState();
  const payload = buildSavePayload(state);
  if (payload.turns.length === 0 && payload.summaries.length === 0) {
    throw new Error("There is nothing to save yet");
  }

  let response;
  try {
    response = await fetchImpl(SAVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    logger.error("save.request_failed", { error: error.message, conversationId: payload.conversationId });
    throw new Error("Save failed: the local server is unreachable");
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Save failed: the server returned an invalid response");
  }
  if (!response.ok) {
    const detail = typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
    logger.error("save.rejected", { status: response.status, detail, conversationId: payload.conversationId });
    throw new Error(`Save failed: ${detail}`);
  }

  logger.info("save.completed", {
    conversationId: payload.conversationId,
    savedTurns: data.saved_turns ?? 0,
    savedThinking: data.saved_thinking ?? 0,
    savedSummaries: data.saved_summaries ?? 0,
  });
  return data;
}
