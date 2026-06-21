import assert from "node:assert/strict";
import test from "node:test";

import { createLogger } from "../logger.js";

test("logger emits structured levels and supports a swappable sink", () => {
  const first = [];
  const second = [];
  const log = createLogger((entry) => first.push(entry));
  log.info("test.first", { key: "value" });
  log.replaceSink((entry) => second.push(entry));
  log.error("test.second", { error: "expected" });

  assert.equal(first[0].level, "info");
  assert.equal(first[0].event, "test.first");
  assert.equal(first[0].key, "value");
  assert.match(first[0].timestamp, /^\d{4}-/);
  assert.equal(second[0].level, "error");
  assert.equal(second[0].event, "test.second");
});
