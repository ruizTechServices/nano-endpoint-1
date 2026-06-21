import assert from "node:assert/strict";
import test from "node:test";

import { chat, ENDPOINT_URL, MODEL, summarize } from "../endpoint.js";
import { logger } from "../logger.js";
import { NYC_TIME_API_URL, SEARCH_PROXY_URL, WEATHER_FORECAST_API_URL, WEATHER_GEOCODING_API_URL } from "../tools.js";

test("chat uses the documented endpoint, fixed model, and response field", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  logger.replaceSink((entry) => calls.push({ log: entry }));
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      model: MODEL,
      message: { role: "assistant", content: "fixed response", thinking: "brief reasoning" },
      done: true,
      done_reason: "stop",
      eval_count: 3,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    assert.deepEqual(await chat([], "hello"), { content: "fixed response", thinking: "brief reasoning" });
    const request = calls.find((call) => call.url);
    const payload = JSON.parse(request.init.body);
    assert.equal(request.url, ENDPOINT_URL);
    assert.equal(payload.model, "qwen3:1.7b");
    assert.equal(payload.stream, false);
    assert.equal(payload.think, true);
    assert.equal(payload.options.num_ctx, 4096);
    assert.equal(payload.options.num_predict, 2048);
    assert.equal(payload.tools.length, 3);
    assert.deepEqual(payload.tools.map((tool) => tool.function.name), ["get_nyc_time", "get_current_weather", "search_web"]);
    assert.equal(payload.messages.at(-1).content, "hello");
    assert.ok(calls.some((call) => call.log?.event === "endpoint.response"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat executes current weather and renders exact Open-Meteo measurements", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.startsWith(WEATHER_GEOCODING_API_URL)) {
      return new Response(JSON.stringify({ results: [{
        name: "Boston",
        admin1: "Massachusetts",
        country: "United States",
        country_code: "US",
        latitude: 42.35843,
        longitude: -71.05977,
        timezone: "America/New_York",
      }] }), { status: 200 });
    }
    if (url.startsWith(WEATHER_FORECAST_API_URL)) {
      return new Response(JSON.stringify({
        timezone: "America/New_York",
        timezone_abbreviation: "GMT-4",
        current_units: {
          temperature_2m: "°F", apparent_temperature: "°F", relative_humidity_2m: "%",
          precipitation: "inch", rain: "inch", showers: "inch", snowfall: "inch",
          cloud_cover: "%", wind_speed_10m: "mp/h", wind_direction_10m: "°", wind_gusts_10m: "mp/h",
        },
        current: {
          time: "2026-06-21T03:15", interval: 900, temperature_2m: 67.6,
          apparent_temperature: 66.2, relative_humidity_2m: 61, precipitation: 0,
          rain: 0, showers: 0, snowfall: 0, weather_code: 2, cloud_cover: 34,
          wind_speed_10m: 6.8, wind_direction_10m: 225, wind_gusts_10m: 12.1,
        },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      model: MODEL,
      message: {
        role: "assistant",
        content: "",
        thinking: "I should use current weather data.",
        tool_calls: [{ function: { name: "get_current_weather", arguments: { location: "Boston, Massachusetts" } } }],
      },
      done: true,
    }), { status: 200 });
  };

  try {
    const result = await chat([], "What is the weather in Boston?");
    assert.match(result.content, /Current weather in Boston, Massachusetts, United States/);
    assert.match(result.content, /\*\*Temperature:\*\* `67\.6 °F`/);
    assert.match(result.content, /Partly cloudy \(WMO code `2`\)/);
    assert.match(result.content, /\*\*Observation time:\*\* `2026-06-21T03:15`/);
    assert.match(result.thinking, /current weather data/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat executes the allowlisted NYC time tool and formats authoritative fields without model rewriting", async () => {
  const originalFetch = globalThis.fetch;
  const ollamaPayloads = [];
  let ollamaCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (url === NYC_TIME_API_URL) {
      return new Response(JSON.stringify({
        year: 2026,
        month: 6,
        day: 21,
        hour: 2,
        minute: 50,
        seconds: 52,
        milliSeconds: 230,
        dateTime: "2026-06-21T02:50:52.2303505",
        date: "06/21/2026",
        time: "02:50",
        timeZone: "America/New_York",
        dayOfWeek: "Sunday",
        dstActive: true,
      }), { status: 200 });
    }

    ollamaCalls += 1;
    ollamaPayloads.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      model: MODEL,
      message: {
        role: "assistant",
        thinking: "I need live time data.",
        content: "",
        tool_calls: [{
          id: "call_time",
          function: { name: "get_nyc_time", arguments: {} },
        }],
      },
      done: true,
    }), { status: 200 });
  };

  try {
    const result = await chat([], "What is the exact current time in NYC?");
    assert.match(result.content, /Exact local date and time:\*\* `2026-06-21T02:50:52\.2303505`/);
    assert.match(result.content, /\*\*Day:\*\* Sunday/);
    assert.doesNotMatch(result.content, /Saturday/);
    assert.match(result.thinking, /live time data/);
    assert.equal(ollamaPayloads.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat executes Brave web search and formats proxy results without model rewriting", async () => {
  const originalFetch = globalThis.fetch;
  let ollamaCalls = 0;
  globalThis.fetch = async (url) => {
    if (url === SEARCH_PROXY_URL) {
      return new Response(JSON.stringify({
        query: "official Python documentation",
        results: [{
          title: "Python 3 Documentation",
          url: "https://docs.python.org/3/",
          description: "The official Python language documentation.",
          age: "today",
        }],
      }), { status: 200 });
    }
    ollamaCalls += 1;
    return new Response(JSON.stringify({
      model: MODEL,
      message: {
        role: "assistant",
        thinking: "I need a live web source.",
        content: "",
        tool_calls: [{ function: { name: "search_web", arguments: { query: "official Python documentation" } } }],
      },
      done: true,
    }), { status: 200 });
  };

  try {
    const result = await chat([], "Find the official Python documentation.");
    assert.match(result.content, /Web search results for official Python documentation/);
    assert.match(result.content, /\[Python 3 Documentation\]\(https:\/\/docs\.python\.org\/3\/\)/);
    assert.match(result.thinking, /live web source/);
    assert.equal(ollamaCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("summarize calls the same endpoint and reads message.content", async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl;
  let observedPayload;
  globalThis.fetch = async (url, init) => {
    observedUrl = url;
    observedPayload = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: MODEL,
      message: { role: "assistant", content: "compressed memory" },
      done: true,
    }), { status: 200 });
  };

  try {
    assert.equal(await summarize([{ user: "u", assistant: "a" }]), "compressed memory");
    assert.equal(observedUrl, ENDPOINT_URL);
    assert.equal(observedPayload.model, MODEL);
    assert.equal(observedPayload.think, false);
    assert.match(observedPayload.messages[1].content, /USER:\nu/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
