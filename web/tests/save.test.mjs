import assert from "node:assert/strict";
import test from "node:test";

import { buildSavePayload, buildSummaryRows } from "../save.js";
import { SUMMARIZE_EVERY } from "../summary.js";

function interaction(index, { thinking } = {}) {
  const base = {
    id: `id-${index}`,
    user: `user-${index}`,
    assistant: `assistant-${index}`,
    ts: new Date(2026, 0, index + 1).toISOString(),
  };
  return thinking === undefined ? base : { ...base, thinking };
}

test("buildSavePayload maps each turn to id, position, text and normalizes missing thinking", () => {
  const state = {
    history: [interaction(0, { thinking: "t0" }), interaction(1)],
    rollingSummary: null,
    interactionCount: 2,
    summaryLog: [],
    conversationId: 5,
  };
  const payload = buildSavePayload(state);
  assert.equal(payload.conversationId, 5);
  assert.equal(payload.turns.length, 2);
  assert.deepEqual(payload.turns[0], {
    id: "id-0",
    position: 0,
    user: "user-0",
    assistant: "assistant-0",
    thinking: "t0",
    ts: state.history[0].ts,
  });
  assert.equal(payload.turns[1].position, 1);
  assert.equal(payload.turns[1].thinking, "");
  assert.deepEqual(payload.summaries, []);
});

test("buildSummaryRows prefers the durable summary log when present", () => {
  const log = [
    { id: "s1", conversationId: 0, position: 20, summary: "first", ts: "t" },
    { id: "s2", conversationId: 0, position: 40, summary: "second", ts: null },
  ];
  const rows = buildSummaryRows(log, "ignored-rolling-summary", 45, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "s1");
  assert.equal(rows[1].position, 40);
});

test("buildSummaryRows back-fills the rolling summary at its consolidation position", () => {
  const rows = buildSummaryRows([], "current rolling", 45, 7);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].position, Math.floor(45 / SUMMARIZE_EVERY) * SUMMARIZE_EVERY);
  assert.equal(rows[0].position, 40);
  assert.equal(rows[0].summary, "current rolling");
  assert.equal(rows[0].conversationId, 7);
  assert.equal(typeof rows[0].id, "string");
});

test("buildSummaryRows returns nothing when there is no summary anywhere", () => {
  assert.deepEqual(buildSummaryRows([], null, 5, 0), []);
});

test("buildSavePayload includes the back-filled summary alongside turns", () => {
  const payload = buildSavePayload({
    history: [interaction(0)],
    rollingSummary: "roll",
    interactionCount: 20,
    summaryLog: [],
    conversationId: 0,
  });
  assert.equal(payload.summaries.length, 1);
  assert.equal(payload.summaries[0].position, 20);
});
