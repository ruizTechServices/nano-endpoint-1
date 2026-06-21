import { clear, loadState, putMany, STATE_KEYS } from "../db.js";
import { chat } from "../endpoint.js";
import { consolidate } from "../summary.js";

const output = document.querySelector("[data-results]");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fixtureHistory(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    user: `browser-user-${index + 1}`,
    assistant: `browser-assistant-${index + 1}`,
    ts: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  }));
}

async function run() {
  await clear();
  await putMany({
    [STATE_KEYS.history]: fixtureHistory(20),
    [STATE_KEYS.summary]: "prior browser memory",
    [STATE_KEYS.counter]: 20,
  });
  const persisted = await loadState();
  assert(persisted.history.length === 20, "history did not persist");
  assert(persisted.rollingSummary === "prior browser memory", "summary did not persist");
  assert(persisted.interactionCount === 20, "counter did not persist");

  let consolidationPayload;
  const nextSummary = await consolidate(
    persisted.history,
    persisted.rollingSummary,
    persisted.interactionCount,
    {
      summarize: async (payload) => {
        consolidationPayload = payload;
        return "consolidated browser memory";
      },
    },
  );
  assert(consolidationPayload.length === 21, "recursive turn-20 payload was incorrect");
  assert(consolidationPayload[0].content === "prior browser memory", "prior summary was not pinned first");
  assert(nextSummary === "consolidated browser memory", "consolidation result was not returned");

  const liveResponse = await chat([], "Think briefly, then reply with exactly: browser endpoint online");
  assert(liveResponse.content.toLowerCase() === "browser endpoint online", "live endpoint answer was unexpected");
  assert(liveResponse.thinking.length > 0, "live endpoint thinking was missing");

  await clear();
  const deleted = await loadState();
  assert(deleted.history.length === 0, "delete did not clear history");
  assert(deleted.rollingSummary === null, "delete did not clear summary");
  assert(deleted.interactionCount === 0, "delete did not clear counter");

  const results = {
    indexedDbPersistenceRoundTrip: "pass",
    consolidationAt20: "pass",
    recursivePayloadItems: consolidationPayload.length,
    liveEndpoint: "pass",
    liveAnswer: liveResponse.content,
    liveThinkingLength: liveResponse.thinking.length,
    deleteAllState: "pass",
  };
  document.body.dataset.state = "passed";
  output.textContent = JSON.stringify(results, null, 2);
}

try {
  await run();
} catch (error) {
  document.body.dataset.state = "failed";
  output.textContent = JSON.stringify({ error: error.message, stack: error.stack }, null, 2);
}
