# tool-use:tools that are currently available and how to use them

This guide describes the tools currently available to the `qwen3:1.7b` model in the Orin Local web application. It explains what each tool does, how a user should prompt for it, what arguments the model must provide, and how the application handles the returned information.

## Available tools

The application exposes exactly three allowlisted tools:

1. `get_nyc_time` — retrieves the live date and time in New York City.
2. `get_current_weather` — retrieves live current weather for a specified place.
3. `search_web` — searches the live public web using Brave Search through the local Python proxy.

The model cannot call arbitrary functions, URLs, shell commands, or tools outside this allowlist. These tools are implemented by the local application; they are not independent capabilities hosted inside the Qwen model or the Orin endpoint.

## How tool selection works

Users do not need to write JSON or name a function. Ask a direct natural-language question that clearly states the desired action and supplies all required details.

The normal flow is:

1. The user submits a message.
2. Qwen3 decides whether one of the available tools is required.
3. The model returns a structured tool call with the appropriate arguments.
4. The application validates the tool name and arguments.
5. The application calls the live data source.
6. Authoritative fields are formatted directly by application code and shown in the chat.

The live tool result is not sent through a second model-generation pass. This prevents the model from changing exact dates, measurements, URLs, or other authoritative fields.

For best results, request one tool operation at a time. If several unrelated live-data requests are placed in one message, the current chat flow may execute only the selected tool call rather than completing every requested operation.

## Tool 1: `get_nyc_time`

### Purpose

Retrieves the exact current local date and time for New York City from TimeAPI.io using the fixed IANA time zone `America/New_York`.

Use this tool for questions involving:

- The current time in New York City or NYC.
- Today's date in New York City.
- The current day of the week in New York City.
- Whether daylight saving time is active in New York City.

### Required arguments

This tool accepts no arguments:

```json
{}
```

The city and time zone cannot be changed. For another location, this tool is not applicable.

### Recommended prompts

```text
What is the exact current date and time in New York City?
```

```text
What time is it in NYC right now?
```

```text
What day and date is it currently in New York City?
```

```text
Is daylight saving time active in New York City right now?
```

### Prompts to avoid

Ambiguous prompt:

```text
What time is it?
```

This does not state that New York City is required. Prefer:

```text
What time is it in New York City right now?
```

Unsupported location:

```text
What time is it in Tokyo?
```

`get_nyc_time` is intentionally fixed to New York City and should not be used for Tokyo or other locations.

### Authoritative output

The frontend directly formats:

- Exact local date and time.
- Calendar date.
- Day of the week.
- `America/New_York` time-zone identifier.
- Daylight-saving-time status.
- Link to the live TimeAPI.io source.

The tool fails instead of substituting the browser clock or the model's internal knowledge.

## Tool 2: `get_current_weather`

### Purpose

Resolves a place using Open-Meteo geocoding and retrieves current conditions from Open-Meteo's forecast service.

Use this tool for current questions involving:

- Temperature or apparent temperature.
- Rain, precipitation, showers, or snow.
- Humidity.
- Cloud cover.
- Wind speed, direction, or gusts.
- General current conditions for a named location.

This tool provides current observations, not a multi-day forecast.

### Required arguments

The tool requires one argument:

```json
{
  "location": "City, State/Province, Country"
}
```

Argument rules:

- `location` must be a string.
- It must contain between 2 and 100 printable characters.
- No additional arguments are accepted.
- Common United States and Canadian state or province abbreviations are accepted.

### Recommended prompt format

```text
What is the current weather in City, State/Province, Country?
```

Examples:

```text
What is the current weather in San Francisco, California, United States?
```

```text
What is the weather in San Francisco, CA right now?
```

```text
What is the current temperature, humidity, and wind in Boston, Massachusetts, USA?
```

```text
Is it raining right now in Toronto, Ontario, Canada?
```

### Why location detail matters

Many cities share the same name. A prompt such as:

```text
What is the weather in Springfield?
```

may resolve to a different Springfield than intended. Include the state, province, or country:

```text
What is the current weather in Springfield, Illinois, United States?
```

If a location cannot be resolved, the application returns guidance asking for the explicit `City, State/Province, Country` format.

### Authoritative output

The frontend directly formats:

- Resolved city, region, and country.
- Observation time and local time zone.
- Temperature and apparent temperature in Fahrenheit.
- WMO weather condition and code.
- Relative humidity.
- Precipitation, rain, showers, and snowfall in inches.
- Cloud cover.
- Wind speed and gusts in miles per hour.
- Wind direction.
- Resolved latitude and longitude.
- Link to the live Open-Meteo request.

The displayed units come from the API response and are validated before rendering.

## Tool 3: `search_web`

### Purpose

Searches the live public web through the Brave Web Search API. The browser calls the same-origin local Python proxy, which keeps the Brave credential on the server.

Use this tool when the answer requires:

- Current or recently changed information.
- Recent news or events.
- Online sources or official websites.
- Documentation, articles, products, organizations, or public pages.
- Verification beyond the model's stored knowledge.

### Required arguments

The tool requires one argument:

```json
{
  "query": "specific web search query"
}
```

Argument rules:

- `query` must be a string.
- It must contain between 2 and 400 printable characters.
- No additional arguments are accepted.
- The frontend requests up to five results from the proxy.

### Recommended prompts

State that a web search is required and describe the target precisely:

```text
Search the web for the official Python 3 documentation.
```

```text
Use web search to find the latest release notes for Node.js 24.
```

```text
Search the web for the official Jetson Orin Nano developer documentation.
```

```text
Find recent reporting about this topic using Brave Search: [topic].
```

```text
Search for the official website of [organization or product].
```

### Improving search results

A useful web-search prompt includes:

- The exact subject.
- The desired source type, such as official documentation or recent news.
- A date, version, place, or organization when relevant.
- Important distinguishing terms.

Weak prompt:

```text
Search Python.
```

Better prompt:

```text
Search the web for the official Python 3.13 library documentation on asyncio.
```

Weak prompt:

```text
Find news.
```

Better prompt:

```text
Search the web for recent news about NVIDIA Jetson devices published during June 2026.
```

### Authoritative output

The frontend directly formats each validated Brave Search result:

- Result title.
- HTTP or HTTPS link.
- Description or snippet when supplied.
- Published age when supplied.

Unsafe URL schemes are rejected. Search result fields are sanitized before Markdown rendering. The model does not rewrite the returned results.

### Server requirement

Web search works only when the application is served by the local Python server. The browser sends the request to:

```text
POST /api/brave-search
```

The server reads `BRAVE_SEARCH_API_KEY` from its process environment and sends it only to the fixed Brave Search endpoint. The credential is not included in frontend JavaScript, IndexedDB, model messages, API responses, or structured logs.

If the page is opened through a static server such as Live Server, the `search_web` route is unavailable. In Git Bash, securely place the existing Brave credential into the current process without putting its value in shell history, then start the application:

```bash
read -rsp "Brave API key: " BRAVE_SEARCH_API_KEY
echo
export BRAVE_SEARCH_API_KEY
python server.py
```

Then use:

```text
http://127.0.0.1:5500/
```

Stop the server with `Ctrl+C`, then remove the session credential with `unset BRAVE_SEARCH_API_KEY`.

## Troubleshooting prompts

### The model answered from memory instead of using a tool

Make the tool requirement explicit:

```text
Use the current weather tool. What is the current weather in Seattle, Washington, United States?
```

```text
Use the NYC time tool and tell me the exact current date and time in New York City.
```

```text
Use Brave web search to find the official documentation for this topic: [topic].
```

### The weather location was not found

Supply a fully qualified place:

```text
What is the current weather in Portland, Oregon, United States?
```

Do not rely on a city name alone when it is shared by multiple locations.

### Web search reports that the Python server is required

The page was probably opened from a static server or directly from disk. Use the application URL served by `python server.py`.

### Brave Search authentication fails

The Python process does not have access to `BRAVE_SEARCH_API_KEY`, or the credential was rejected by Brave. The application deliberately returns a safe error and never falls back to exposing the credential in browser code.

### The requested operation is not one of the three tools

The application rejects unknown tool names. Currently unsupported examples include arbitrary URL fetching, file access, shell commands, database queries, email, calculations through external services, and time lookup outside New York City.

## Quick prompt reference

| Goal | Recommended prompt |
|---|---|
| Exact NYC time | `What is the exact current date and time in New York City?` |
| Current weather | `What is the current weather in City, State/Province, Country?` |
| Current temperature | `Use the weather tool. What is the current temperature in Boston, Massachusetts, USA?` |
| Official website | `Search the web for the official website of [name].` |
| Official documentation | `Use Brave web search to find the official documentation for [product and version].` |
| Recent information | `Search the web for recent information about [specific topic and date range].` |

## Summary

Use clear, direct prompts and provide every required detail:

- Say `New York City` or `NYC` for the fixed time tool.
- Give `City, State/Province, Country` for weather.
- Ask explicitly for web search and provide a specific query for Brave Search.

The application validates every tool call and formats authoritative live fields directly, while Qwen3 remains responsible for deciding when a tool is appropriate and constructing the permitted arguments.
