import assert from "node:assert/strict";
import test from "node:test";

import {
  executeToolCall,
  formatCurrentWeatherResult,
  formatNycTimeResult,
  formatWebSearchResult,
  getCurrentWeather,
  getNycTime,
  NYC_TIME_API_URL,
  SEARCH_PROXY_URL,
  searchWeb,
  TOOL_DEFINITIONS,
  WEATHER_FORECAST_API_URL,
  WEATHER_GEOCODING_API_URL,
} from "../tools.js";

const validTime = {
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
};

test("publishes only the three allowlisted tools", () => {
  assert.equal(TOOL_DEFINITIONS.length, 3);
  const timeTool = TOOL_DEFINITIONS.find((tool) => tool.function.name === "get_nyc_time");
  const weatherTool = TOOL_DEFINITIONS.find((tool) => tool.function.name === "get_current_weather");
  const searchTool = TOOL_DEFINITIONS.find((tool) => tool.function.name === "search_web");
  assert.deepEqual(timeTool.function.parameters.properties, {});
  assert.equal(timeTool.function.parameters.additionalProperties, false);
  assert.deepEqual(weatherTool.function.parameters.required, ["location"]);
  assert.equal(weatherTool.function.parameters.additionalProperties, false);
  assert.deepEqual(searchTool.function.parameters.required, ["query"]);
  assert.equal(searchTool.function.parameters.additionalProperties, false);
});

test("retrieves and normalizes live NYC time fields from the fixed endpoint", async () => {
  let observedUrl;
  const result = JSON.parse(await getNycTime(async (url) => {
    observedUrl = url;
    return new Response(JSON.stringify(validTime), { status: 200 });
  }));
  assert.equal(observedUrl, NYC_TIME_API_URL);
  assert.equal(result.source, "TimeAPI.io");
  assert.equal(result.timeZone, "America/New_York");
  assert.equal(result.localDateTime, "2026-06-21T02:50:52.2303505");
  assert.equal(result.dayOfWeek, "Sunday");
  assert.equal(result.dstActive, true);
});

test("executes only get_nyc_time with no arguments", async () => {
  const fetchImpl = async () => new Response(JSON.stringify(validTime), { status: 200 });
  const result = JSON.parse(await executeToolCall({ function: { name: "get_nyc_time", arguments: {} } }, fetchImpl));
  assert.equal(result.timeZone, "America/New_York");
  await assert.rejects(
    executeToolCall({ function: { name: "get_nyc_time", arguments: { city: "Boston" } } }, fetchImpl),
    /does not accept arguments/,
  );
  await assert.rejects(
    executeToolCall({ function: { name: "run_shell", arguments: {} } }, fetchImpl),
    /not allowed/,
  );
});

test("formats authoritative time fields without changing them", () => {
  const markdown = formatNycTimeResult(JSON.stringify({
    source: "TimeAPI.io",
    sourceUrl: NYC_TIME_API_URL,
    timeZone: "America/New_York",
    localDateTime: "2026-06-21T02:50:52.2303505",
    date: "06/21/2026",
    time: "02:50",
    dayOfWeek: "Sunday",
    dstActive: true,
  }));
  assert.match(markdown, /`2026-06-21T02:50:52\.2303505`/);
  assert.match(markdown, /\*\*Day:\*\* Sunday/);
  assert.doesNotMatch(markdown, /Saturday/);
});

const weatherGeocoding = {
  results: [{
    name: "Boston",
    admin1: "Massachusetts",
    country: "United States",
    country_code: "US",
    latitude: 42.35843,
    longitude: -71.05977,
    timezone: "America/New_York",
  }],
};

const weatherForecast = {
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
};

function weatherFetch(url) {
  if (url.startsWith(WEATHER_GEOCODING_API_URL)) {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("name"), "Boston");
    assert.equal(parsed.searchParams.get("count"), "10");
    return Promise.resolve(new Response(JSON.stringify(weatherGeocoding), { status: 200 }));
  }
  if (url.startsWith(WEATHER_FORECAST_API_URL)) {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("temperature_unit"), "fahrenheit");
    assert.equal(parsed.searchParams.get("wind_speed_unit"), "mph");
    return Promise.resolve(new Response(JSON.stringify(weatherForecast), { status: 200 }));
  }
  throw new Error(`Unexpected URL: ${url}`);
}

test("resolves a location and returns validated authoritative weather fields", async () => {
  const result = JSON.parse(await getCurrentWeather("Boston, Massachusetts", weatherFetch));
  assert.equal(result.source, "Open-Meteo");
  assert.equal(result.resolvedLocation.name, "Boston");
  assert.equal(result.observation.time, "2026-06-21T03:15");
  assert.equal(result.current.temperature_2m, 67.6);
  assert.equal(result.units.temperature_2m, "°F");
});

test("accepts common state abbreviations such as San Francisco, CA", async () => {
  const result = JSON.parse(await getCurrentWeather("San Francisco, CA", async (url) => {
    if (url.startsWith(WEATHER_GEOCODING_API_URL)) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("name"), "San Francisco");
      return new Response(JSON.stringify({ results: [{
        name: "San Francisco",
        admin1: "California",
        country: "United States",
        country_code: "US",
        latitude: 37.77493,
        longitude: -122.41942,
        timezone: "America/Los_Angeles",
      }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      ...weatherForecast,
      timezone: "America/Los_Angeles",
      timezone_abbreviation: "GMT-7",
    }), { status: 200 });
  }));
  assert.equal(result.resolvedLocation.name, "San Francisco");
  assert.equal(result.resolvedLocation.admin1, "California");
  assert.equal(result.observation.timeZone, "America/Los_Angeles");
});

test("weather dispatcher accepts only location and the formatter preserves exact measurements", async () => {
  const serialized = await executeToolCall({
    function: { name: "get_current_weather", arguments: JSON.stringify({ location: "Boston, Massachusetts" }) },
  }, weatherFetch);
  const markdown = formatCurrentWeatherResult(serialized);
  assert.match(markdown, /Boston, Massachusetts, United States/);
  assert.match(markdown, /`67\.6 °F`/);
  assert.match(markdown, /Partly cloudy \(WMO code `2`\)/);
  assert.match(markdown, /`2026-06-21T03:15`/);
  assert.match(markdown, /`America\/New_York`/);
  await assert.rejects(
    executeToolCall({ function: { name: "get_current_weather", arguments: { location: "Boston", units: "kelvin" } } }, weatherFetch),
    /unexpected arguments/,
  );
});

test("weather tool fails closed for missing locations, no matches, and malformed measurements", async () => {
  await assert.rejects(
    getCurrentWeather("", weatherFetch),
    /Try this exact prompt format: "What is the current weather in City, State\/Province, Country\?"/,
  );
  await assert.rejects(
    getCurrentWeather("Boston, Texas", async (url) => {
      if (url.startsWith(WEATHER_GEOCODING_API_URL)) return new Response(JSON.stringify(weatherGeocoding), { status: 200 });
      throw new Error("Forecast should not be called for a mismatched qualifier");
    }),
    /Could not resolve the weather location.*Try this exact prompt format/s,
  );
  await assert.rejects(
    getCurrentWeather("Nowhere", async (url) => {
      if (url.startsWith(WEATHER_GEOCODING_API_URL)) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      throw new Error("Forecast should not be called");
    }),
    /Could not resolve the weather location.*San Francisco, California, United States/s,
  );
  await assert.rejects(
    getCurrentWeather("Boston", async (url) => {
      if (url.startsWith(WEATHER_GEOCODING_API_URL)) return new Response(JSON.stringify(weatherGeocoding), { status: 200 });
      return new Response(JSON.stringify({ ...weatherForecast, current: { ...weatherForecast.current, temperature_2m: "warm" } }), { status: 200 });
    }),
    /invalid temperature_2m/,
  );
});

test("fails closed on malformed or unsuccessful time responses", async () => {
  await assert.rejects(
    getNycTime(async () => new Response("unavailable", { status: 503 })),
    /HTTP 503/,
  );
  await assert.rejects(
    getNycTime(async () => new Response(JSON.stringify({ ...validTime, timeZone: "UTC" }), { status: 200 })),
    /invalid America\/New_York response/,
  );
});

test("web search calls only the same-origin proxy and validates normalized results", async () => {
  let observedUrl;
  let observedInit;
  const serialized = await searchWeb("official Python documentation", async (url, init) => {
    observedUrl = url;
    observedInit = init;
    return new Response(JSON.stringify({
      query: "official Python documentation",
      results: [{
        title: "Python 3 Documentation",
        url: "https://docs.python.org/3/",
        description: "The official Python documentation.",
        age: "2 days ago",
      }],
    }), { status: 200 });
  });
  assert.equal(observedUrl, SEARCH_PROXY_URL);
  assert.equal(observedInit.method, "POST");
  assert.deepEqual(JSON.parse(observedInit.body), { query: "official Python documentation", count: 5 });
  assert.equal(JSON.parse(serialized).results[0].url, "https://docs.python.org/3/");
});

test("web search dispatcher rejects extra arguments and formats authoritative results safely", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    query: "Python docs",
    results: [{
      title: "[Python] **Docs**",
      url: "https://docs.python.org/3/",
      description: "Official <documentation> for `Python`.",
      age: "today",
    }],
  }), { status: 200 });
  const serialized = await executeToolCall({
    function: { name: "search_web", arguments: JSON.stringify({ query: "Python docs" }) },
  }, fetchImpl);
  const markdown = formatWebSearchResult(serialized);
  assert.match(markdown, /Web search results for Python docs/);
  assert.match(markdown, /\[Python Docs\]\(https:\/\/docs\.python\.org\/3\/\)/);
  assert.doesNotMatch(markdown, /\*\*Docs\*\*/);
  await assert.rejects(
    executeToolCall({ function: { name: "search_web", arguments: { query: "Python", key: "secret" } } }, fetchImpl),
    /unexpected arguments/,
  );
});

test("web search fails closed on invalid queries, unsafe URLs, and proxy errors", async () => {
  await assert.rejects(searchWeb(" ", async () => new Response("{}")), /2 to 400 printable/);
  await assert.rejects(
    searchWeb("test query", async () => new Response(JSON.stringify({
      query: "test query",
      results: [{ title: "unsafe", url: "javascript:alert(1)" }],
    }), { status: 200 })),
    /unsafe result URL/,
  );
  await assert.rejects(
    searchWeb("test query", async () => new Response(JSON.stringify({ error: "Brave Search rate limit reached" }), { status: 502 })),
    /HTTP 502: Brave Search rate limit reached/,
  );
});
