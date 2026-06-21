import { logger } from "./logger.js";

export const NYC_TIME_API_URL =
  "https://timeapi.io/api/time/current/zone?timeZone=America%2FNew_York";
export const WEATHER_GEOCODING_API_URL = "https://geocoding-api.open-meteo.com/v1/search";
export const WEATHER_FORECAST_API_URL = "https://api.open-meteo.com/v1/forecast";
export const SEARCH_PROXY_URL = "/api/brave-search";

export const TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    type: "function",
    function: Object.freeze({
      name: "get_nyc_time",
      description:
        "Get the exact current local date and time in New York City from a live external time service. Use this whenever the user asks for the current time or date in NYC or New York City.",
      parameters: Object.freeze({
        type: "object",
        properties: Object.freeze({}),
        additionalProperties: false,
      }),
    }),
  }),
  Object.freeze({
    type: "function",
    function: Object.freeze({
      name: "get_current_weather",
      description:
        "Get validated current weather for a city or place from live Open-Meteo data. Use this whenever the user asks about current weather, temperature, rain, snow, clouds, or wind in a location.",
      parameters: Object.freeze({
        type: "object",
        properties: Object.freeze({
          location: Object.freeze({
            type: "string",
            description: "City or place name, optionally including state/province and country, for example: Boston, Massachusetts, USA",
            minLength: 2,
            maxLength: 100,
          }),
        }),
        required: Object.freeze(["location"]),
        additionalProperties: false,
      }),
    }),
  }),
  Object.freeze({
    type: "function",
    function: Object.freeze({
      name: "search_web",
      description:
        "Search the live public web with Brave Search. Use this when the user asks for current information, online sources, websites, recent events, or facts that require web research.",
      parameters: Object.freeze({
        type: "object",
        properties: Object.freeze({
          query: Object.freeze({
            type: "string",
            description: "A specific web search query containing 2 to 400 printable characters.",
            minLength: 2,
            maxLength: 400,
          }),
        }),
        required: Object.freeze(["query"]),
        additionalProperties: false,
      }),
    }),
  }),
]);

const TIMEOUT_MS = 10_000;
const encoder = new TextEncoder();

const WEATHER_CODE_DESCRIPTIONS = Object.freeze({
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
});

const WEATHER_NUMERIC_FIELDS = Object.freeze([
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "precipitation",
  "rain",
  "showers",
  "snowfall",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
]);

const LOCATION_QUALIFIER_ALIASES = Object.freeze({
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri",
  mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey",
  nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio",
  ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
  sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont",
  va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
  dc: "district of columbia",
  ab: "alberta", bc: "british columbia", mb: "manitoba", nb: "new brunswick",
  nl: "newfoundland and labrador", ns: "nova scotia", nt: "northwest territories",
  nu: "nunavut", on: "ontario", pe: "prince edward island", qc: "quebec",
  sk: "saskatchewan", yt: "yukon",
  us: "united states", usa: "united states", uk: "united kingdom",
});

const WEATHER_PROMPT_GUIDANCE =
  'Try this exact prompt format: "What is the current weather in City, State/Province, Country?" Example: "What is the current weather in San Francisco, California, United States?" Common abbreviations such as CA and US are also accepted.';

function parseArguments(value) {
  if (value == null || value === "") return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error("get_nyc_time received invalid JSON arguments");
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value;
  throw new Error("get_nyc_time arguments must be an object");
}

function validateTimeResponse(data) {
  if (
    data?.timeZone !== "America/New_York" ||
    typeof data.dateTime !== "string" ||
    typeof data.date !== "string" ||
    typeof data.time !== "string" ||
    typeof data.dayOfWeek !== "string" ||
    typeof data.dstActive !== "boolean"
  ) {
    throw new Error("Time service returned an invalid America/New_York response");
  }
}

export async function getNycTime(fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();
  let status = 0;

  logger.info("tool.request", {
    tool: "get_nyc_time",
    source: "TimeAPI.io",
    url: NYC_TIME_API_URL,
  });

  try {
    const response = await fetchImpl(NYC_TIME_API_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    status = response.status;
    const responseText = await response.text();
    const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;

    if (!response.ok) throw new Error(`Time service returned HTTP ${status}`);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error("Time service returned invalid JSON");
    }
    validateTimeResponse(data);

    const result = {
      source: "TimeAPI.io",
      sourceUrl: NYC_TIME_API_URL,
      timeZone: data.timeZone,
      localDateTime: data.dateTime,
      date: data.date,
      time: data.time,
      dayOfWeek: data.dayOfWeek,
      dstActive: data.dstActive,
    };
    logger.info("tool.response", {
      tool: "get_nyc_time",
      source: "TimeAPI.io",
      status,
      latencyMs,
      responseSize: encoder.encode(responseText).byteLength,
      result,
    });
    return JSON.stringify(result);
  } catch (error) {
    logger.error("tool.error", {
      tool: "get_nyc_time",
      source: "TimeAPI.io",
      status,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      error: error.name === "AbortError" ? "Time service request timed out" : error.message,
    });
    if (error.name === "AbortError") throw new Error("Time service request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateSearchQuery(query) {
  if (typeof query !== "string") throw new Error("Web search requires a query");
  const cleaned = query.trim();
  if (cleaned.length < 2 || cleaned.length > 400 || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new Error("The web search query must contain 2 to 400 printable characters");
  }
  return cleaned;
}

function validateSearchResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Search proxy returned an invalid result");
  }
  if (typeof result.title !== "string" || !result.title.trim() || typeof result.url !== "string") {
    throw new Error("Search proxy returned an incomplete result");
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(result.url);
  } catch {
    throw new Error("Search proxy returned an invalid result URL");
  }
  if (!(["http:", "https:"].includes(parsedUrl.protocol))) {
    throw new Error("Search proxy returned an unsafe result URL");
  }
  if (
    (result.description != null && typeof result.description !== "string") ||
    (result.age != null && typeof result.age !== "string")
  ) {
    throw new Error("Search proxy returned invalid result fields");
  }
  return {
    title: result.title.trim().slice(0, 500),
    url: parsedUrl.href.slice(0, 2048),
    description: (result.description ?? "").trim().slice(0, 2000),
    age: (result.age ?? "").trim().slice(0, 100),
  };
}

export async function searchWeb(query, fetchImpl = fetch) {
  const cleanedQuery = validateSearchQuery(query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const startedAt = performance.now();
  let status = 0;
  logger.info("tool.request", {
    tool: "search_web",
    source: "Brave Search via local proxy",
    queryLength: cleanedQuery.length,
  });

  try {
    const response = await fetchImpl(SEARCH_PROXY_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ query: cleanedQuery, count: 5 }),
      signal: controller.signal,
    });
    status = response.status;
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error("Search proxy returned invalid JSON");
    }
    if (!response.ok) {
      const detail = typeof data?.error === "string" ? `: ${data.error}` : "";
      throw new Error(`Search proxy returned HTTP ${status}${detail}`);
    }
    if (data?.query !== cleanedQuery || !Array.isArray(data.results) || data.results.length > 10) {
      throw new Error("Search proxy returned an invalid response shape");
    }
    const result = { query: cleanedQuery, results: data.results.map(validateSearchResult) };
    logger.info("tool.response", {
      tool: "search_web",
      source: "Brave Search via local proxy",
      status,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      responseSize: encoder.encode(responseText).byteLength,
      resultCount: result.results.length,
    });
    return JSON.stringify(result);
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Web search request timed out"
      : error instanceof TypeError
        ? "Web search requires the local Python server. Start the application with: python server.py"
        : error.message;
    logger.error("tool.error", {
      tool: "search_web",
      source: "Brave Search via local proxy",
      status,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      error: message,
    });
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeToolCall(toolCall, fetchImpl = fetch) {
  const name = toolCall?.function?.name;
  if (name !== "get_nyc_time" && name !== "get_current_weather" && name !== "search_web") {
    throw new Error(`Tool is not allowed: ${name ?? "missing name"}`);
  }
  const args = parseArguments(toolCall.function.arguments);
  if (name === "get_nyc_time") {
    if (Object.keys(args).length > 0) throw new Error("get_nyc_time does not accept arguments");
    return getNycTime(fetchImpl);
  }
  if (name === "get_current_weather") {
    if (Object.keys(args).some((key) => key !== "location")) {
      throw new Error("get_current_weather received unexpected arguments");
    }
    return getCurrentWeather(args.location, fetchImpl);
  }
  if (name === "search_web") {
    if (Object.keys(args).some((key) => key !== "query")) {
      throw new Error("search_web received unexpected arguments");
    }
    return searchWeb(args.query, fetchImpl);
  }
  throw new Error(`Tool dispatcher is incomplete for: ${name}`);
}

export function formatNycTimeResult(serializedResult) {
  let result;
  try {
    result = JSON.parse(serializedResult);
  } catch {
    throw new Error("Cannot format an invalid NYC time tool result");
  }
  if (
    result?.timeZone !== "America/New_York" ||
    typeof result.localDateTime !== "string" ||
    typeof result.date !== "string" ||
    typeof result.dayOfWeek !== "string" ||
    typeof result.dstActive !== "boolean"
  ) {
    throw new Error("Cannot format an incomplete NYC time tool result");
  }

  return [
    "## Current time in New York City",
    "",
    `- **Exact local date and time:** \`${result.localDateTime}\``,
    `- **Date:** ${result.date}`,
    `- **Day:** ${result.dayOfWeek}`,
    `- **Time zone:** \`${result.timeZone}\``,
    `- **Daylight saving time:** ${result.dstActive ? "Active" : "Inactive"}`,
    "",
    `[Live source: TimeAPI.io](${result.sourceUrl})`,
  ].join("\n");
}

function validateLocation(location) {
  if (typeof location !== "string") {
    throw new Error(`The weather tool needs a location. ${WEATHER_PROMPT_GUIDANCE}`);
  }
  const cleaned = location.trim();
  if (cleaned.length < 2 || cleaned.length > 100 || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new Error(`The weather location must contain 2 to 100 printable characters. ${WEATHER_PROMPT_GUIDANCE}`);
  }
  return cleaned;
}

function finiteNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Weather service returned an invalid ${field}`);
  }
  return value;
}

function normalizedPlaceText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function selectGeocodingResult(results, locationParts) {
  if (!Array.isArray(results) || results.length === 0) return null;
  if (locationParts.length === 1) return results[0];

  const qualifierTokens = normalizedPlaceText(locationParts.slice(1).join(" "))
    .split(" ")
    .filter(Boolean)
    .flatMap((token) => normalizedPlaceText(LOCATION_QUALIFIER_ALIASES[token] ?? token).split(" "));
  return results.find((candidate) => {
    const candidateText = normalizedPlaceText([
      candidate.admin1,
      candidate.admin2,
      candidate.country,
      candidate.country_code,
    ].filter(Boolean).join(" "));
    return qualifierTokens.every((token) => candidateText.split(" ").some((word) => word === token));
  }) ?? null;
}

function unresolvedWeatherLocationError(location) {
  return new Error(`Could not resolve the weather location "${location}". ${WEATHER_PROMPT_GUIDANCE}`);
}

async function fetchWeatherJson(url, phase, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();
  let status = 0;
  logger.info("tool.request", { tool: "get_current_weather", source: "Open-Meteo", phase, url });

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    status = response.status;
    const responseText = await response.text();
    const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
    if (!response.ok) throw new Error(`Open-Meteo ${phase} returned HTTP ${status}`);
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`Open-Meteo ${phase} returned invalid JSON`);
    }
    logger.info("tool.http_response", {
      tool: "get_current_weather",
      source: "Open-Meteo",
      phase,
      status,
      latencyMs,
      responseSize: encoder.encode(responseText).byteLength,
    });
    return data;
  } catch (error) {
    logger.error("tool.error", {
      tool: "get_current_weather",
      source: "Open-Meteo",
      phase,
      status,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      error: error.name === "AbortError" ? `Open-Meteo ${phase} timed out` : error.message,
    });
    if (error.name === "AbortError") throw new Error(`Open-Meteo ${phase} timed out`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCurrentWeather(location, fetchImpl = fetch) {
  const cleanedLocation = validateLocation(location);
  const locationParts = cleanedLocation.split(",").map((part) => part.trim()).filter(Boolean);
  const searchName = locationParts[0];
  const geocodingUrl = new URL(WEATHER_GEOCODING_API_URL);
  geocodingUrl.search = new URLSearchParams({
    name: searchName,
    count: "10",
    language: "en",
    format: "json",
  }).toString();
  const geocoding = await fetchWeatherJson(geocodingUrl.toString(), "geocoding", fetchImpl);
  const place = selectGeocodingResult(geocoding?.results, locationParts);
  if (
    !place ||
    typeof place.name !== "string" ||
    typeof place.country !== "string" ||
    typeof place.timezone !== "string"
  ) {
    throw unresolvedWeatherLocationError(cleanedLocation);
  }
  const latitude = finiteNumber(place.latitude, "geocoding latitude");
  const longitude = finiteNumber(place.longitude, "geocoding longitude");

  const forecastUrl = new URL(WEATHER_FORECAST_API_URL);
  forecastUrl.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "precipitation",
      "rain",
      "showers",
      "snowfall",
      "weather_code",
      "cloud_cover",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
    ].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
  }).toString();
  const weather = await fetchWeatherJson(forecastUrl.toString(), "current_weather", fetchImpl);
  const current = weather?.current;
  const units = weather?.current_units;
  if (
    !current ||
    !units ||
    typeof current.time !== "string" ||
    typeof weather.timezone !== "string" ||
    typeof weather.timezone_abbreviation !== "string"
  ) {
    throw new Error("Open-Meteo returned an incomplete current weather response");
  }

  for (const field of WEATHER_NUMERIC_FIELDS) finiteNumber(current[field], field);
  for (const field of WEATHER_NUMERIC_FIELDS.filter((field) => field !== "weather_code")) {
    if (typeof units[field] !== "string") throw new Error(`Open-Meteo omitted the unit for ${field}`);
  }

  const result = {
    source: "Open-Meteo",
    geocodingSourceUrl: geocodingUrl.toString(),
    weatherSourceUrl: forecastUrl.toString(),
    requestedLocation: cleanedLocation,
    resolvedLocation: {
      name: place.name,
      admin1: typeof place.admin1 === "string" ? place.admin1 : "",
      country: place.country,
      countryCode: typeof place.country_code === "string" ? place.country_code : "",
      latitude,
      longitude,
    },
    observation: {
      time: current.time,
      intervalSeconds: finiteNumber(current.interval, "observation interval"),
      timeZone: weather.timezone,
      timeZoneAbbreviation: weather.timezone_abbreviation,
    },
    current: Object.fromEntries(WEATHER_NUMERIC_FIELDS.map((field) => [field, current[field]])),
    units: Object.fromEntries(WEATHER_NUMERIC_FIELDS
      .filter((field) => field !== "weather_code")
      .map((field) => [field, units[field]])),
  };
  logger.info("tool.response", {
    tool: "get_current_weather",
    source: "Open-Meteo",
    resolvedLocation: result.resolvedLocation,
    observation: result.observation,
    current: result.current,
    units: result.units,
  });
  return JSON.stringify(result);
}

function safeLabel(value) {
  return String(value).replace(/[^\p{L}\p{N} _.,'()\-/]/gu, "").trim();
}

function measurement(result, field) {
  return `\`${result.current[field]} ${result.units[field]}\``;
}

export function formatCurrentWeatherResult(serializedResult) {
  let result;
  try {
    result = JSON.parse(serializedResult);
  } catch {
    throw new Error("Cannot format an invalid current weather tool result");
  }
  const place = result?.resolvedLocation;
  const observation = result?.observation;
  if (
    !place ||
    !observation ||
    !result.current ||
    !result.units ||
    result.source !== "Open-Meteo" ||
    typeof place.name !== "string" ||
    typeof place.country !== "string" ||
    typeof observation.time !== "string" ||
    typeof observation.timeZone !== "string" ||
    typeof observation.timeZoneAbbreviation !== "string" ||
    typeof result.weatherSourceUrl !== "string" ||
    !result.weatherSourceUrl.startsWith(WEATHER_FORECAST_API_URL)
  ) {
    throw new Error("Cannot format an incomplete current weather tool result");
  }
  finiteNumber(place.latitude, "formatted latitude");
  finiteNumber(place.longitude, "formatted longitude");
  for (const field of WEATHER_NUMERIC_FIELDS) finiteNumber(result.current[field], `formatted ${field}`);
  for (const field of WEATHER_NUMERIC_FIELDS.filter((field) => field !== "weather_code")) {
    if (typeof result.units[field] !== "string") {
      throw new Error(`Cannot format weather without a unit for ${field}`);
    }
  }
  const code = result.current.weather_code;
  const condition = WEATHER_CODE_DESCRIPTIONS[code] ?? "Unknown WMO condition";
  const locationParts = [safeLabel(place.name), safeLabel(place.admin1), safeLabel(place.country)].filter(Boolean);

  return [
    `## Current weather in ${locationParts.join(", ")}`,
    "",
    `- **Observation time:** \`${observation.time}\` (\`${safeLabel(observation.timeZone)}\`, ${safeLabel(observation.timeZoneAbbreviation)})`,
    `- **Temperature:** ${measurement(result, "temperature_2m")}`,
    `- **Feels like:** ${measurement(result, "apparent_temperature")}`,
    `- **Condition:** ${condition} (WMO code \`${code}\`)`,
    `- **Relative humidity:** ${measurement(result, "relative_humidity_2m")}`,
    `- **Precipitation:** ${measurement(result, "precipitation")}`,
    `- **Rain:** ${measurement(result, "rain")}`,
    `- **Showers:** ${measurement(result, "showers")}`,
    `- **Snowfall:** ${measurement(result, "snowfall")}`,
    `- **Cloud cover:** ${measurement(result, "cloud_cover")}`,
    `- **Wind:** ${measurement(result, "wind_speed_10m")} from \`${result.current.wind_direction_10m}${result.units.wind_direction_10m}\`; gusts ${measurement(result, "wind_gusts_10m")}`,
    `- **Resolved coordinates:** \`${place.latitude}, ${place.longitude}\``,
    "",
    `[Live source: Open-Meteo](${result.weatherSourceUrl})`,
  ].join("\n");
}

function safeSearchText(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\`*_[\]{}()<>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatWebSearchResult(serializedResult) {
  let result;
  try {
    result = JSON.parse(serializedResult);
  } catch {
    throw new Error("Cannot format an invalid web search tool result");
  }
  if (typeof result?.query !== "string" || !Array.isArray(result.results) || result.results.length > 10) {
    throw new Error("Cannot format an incomplete web search tool result");
  }
  const results = result.results.map(validateSearchResult);
  const lines = [`## Web search results for ${safeSearchText(result.query)}`, ""];
  if (results.length === 0) {
    lines.push("No web results were found.");
  } else {
    results.forEach((item, index) => {
      const url = item.url.replace(/\(/g, "%28").replace(/\)/g, "%29");
      lines.push(`${index + 1}. [${safeSearchText(item.title)}](${url})`);
      if (item.description) lines.push(`   ${safeSearchText(item.description)}`);
      if (item.age) lines.push(`   Published: ${safeSearchText(item.age)}`);
    });
  }
  lines.push("", "Results supplied live by Brave Search through the local server.");
  return lines.join("\n");
}

export function formatToolResult(toolCall, serializedResult) {
  const name = toolCall?.function?.name;
  if (name === "get_nyc_time") return formatNycTimeResult(serializedResult);
  if (name === "get_current_weather") return formatCurrentWeatherResult(serializedResult);
  if (name === "search_web") return formatWebSearchResult(serializedResult);
  throw new Error(`No formatter is allowed for tool: ${name ?? "missing name"}`);
}
