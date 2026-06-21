import assert from "node:assert/strict";
import test from "node:test";

import { buildContext, contextSlotCount } from "../context.js";
import { consolidate, shouldConsolidate, SUMMARIZE_EVERY } from "../summary.js";

function history(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    user: `user-${index + 1}`,
    assistant: `assistant-${index + 1}`,
    ts: new Date(2026, 0, index + 1).toISOString(),
  }));
}

test("cold start builds an empty context", () => {
  assert.deepEqual(buildContext([], null), []);
  assert.equal(contextSlotCount([], null), 0);
});

test("without summary, context contains the last eight raw interactions", () => {
  const context = buildContext(history(10), null);
  assert.equal(context.length, 16);
  assert.equal(context[0].content, "user-3");
  assert.equal(context.at(-1).content, "assistant-10");
  assert.equal(contextSlotCount(history(10), null), 8);
});

test("summary consumes the first slot and only seven raw interactions remain", () => {
  const context = buildContext(history(10), "durable memory");
  assert.equal(context.length, 15);
  assert.equal(context[0].role, "system");
  assert.match(context[0].content, /durable memory/);
  assert.equal(context[1].content, "user-4");
  assert.equal(contextSlotCount(history(10), "durable memory"), 8);
});

test("consolidation cadence fires at exactly every twentieth interaction", () => {
  assert.equal(SUMMARIZE_EVERY, 20);
  assert.equal(shouldConsolidate(0), false);
  assert.equal(shouldConsolidate(19), false);
  assert.equal(shouldConsolidate(20), true);
  assert.equal(shouldConsolidate(21), false);
  assert.equal(shouldConsolidate(40), true);
});

test("recursive consolidation includes prior summary and last twenty turns", async () => {
  let observed;
  const endpoint = {
    summarize: async (payload) => {
      observed = payload;
      return "next memory";
    },
  };
  const result = await consolidate(history(25), "prior memory", 40, endpoint);
  assert.equal(result, "next memory");
  assert.equal(observed.length, 21);
  assert.deepEqual(observed[0], { type: "summary", content: "prior memory" });
  assert.equal(observed[1].user, "user-6");
});

test("summary failure is non-fatal and preserves prior memory", async () => {
  const endpoint = { summarize: async () => { throw new Error("offline"); } };
  assert.equal(await consolidate(history(20), "safe memory", 20, endpoint), "safe memory");
});
