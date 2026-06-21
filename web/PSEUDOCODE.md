# Orin Local — module pseudocode

This pseudocode precedes all browser implementation files.

## `db.js`

```text
open database and create one key/value state store on first run
log database open and upgrade events through an injected logger
get(key): read one state value; log store/action/key
put(key, value): write one state value; log store/action/key
putMany(entries): atomically write history, summary, and counter; log each key
clear(): clear the state store; log store/action
loadState(): read history, summary, and counter with safe defaults
```

## `endpoint.js`

```text
fix endpoint URL to the documented /api/chat URL
fix model to qwen3:1.7b and never accept a model override
request(type, messages, options):
    construct the documented non-streaming Ollama payload
    log type, fixed model, payload byte size, and attempt
    POST JSON with fetch and an abort timeout
    retry network errors, 429, and 5xx using bounded exponential delay
    parse JSON; read final text from message.content
    log status, latency, payload size, token count, and error if present
chat(contextMessages, userMessage): append user message, enable documented thinking,
    use a 4096-token context and 2048-token generation ceiling,
    advertise only the three fixed allowlisted tools:
    get_nyc_time, get_current_weather, and search_web
    when no tool is selected, return both message.content and message.thinking unchanged
    when exactly one allowed tool is selected, execute it through tools.js,
    validate and format the tool result deterministically for the user
    do not ask the small model to rewrite authoritative tool fields
summarize(consolidationItems): build a compression instruction and request summary
    keep thinking disabled and return message.content only
```

## `tools.js`

```text
define the Ollama function schema get_nyc_time with no arguments
fix its data source to the credential-free TimeAPI.io America/New_York endpoint
executeToolCall(call):
    reject every function name except get_nyc_time
    reject unexpected arguments
    fetch the fixed HTTPS URL with a short timeout
    validate HTTP status and required time response fields
    return the server-provided local dateTime, timezone, weekday, and DST status as JSON
    format the validated JSON into Markdown without changing any time fields
    never substitute the browser clock or model knowledge on failure
    log tool name, source, status, latency, response size, and errors

define get_current_weather with one required location string
getCurrentWeather(location):
    validate and length-limit the location
    split comma-delimited city and qualifiers
    expand common US state, Canadian province, and country abbreviations
    resolve it through the credential-free Open-Meteo geocoding endpoint
    require a concrete result whose state/province/country matches supplied qualifiers
    if resolution fails, return an actionable error containing the exact recommended
    prompt shape: "What is the current weather in City, State/Province, Country?"
    call the fixed Open-Meteo forecast endpoint for current measurements
    request explicit Fahrenheit, mph, and inch units
    validate observation time, units, weather code, and every numeric field
    return the resolved place, coordinates, timestamp, timezone, measurements,
    units, and source URLs as structured JSON
formatCurrentWeatherResult(result):
    deterministically format only validated API fields as Markdown
    map the numeric WMO weather code through a fixed local description table
    never ask the model to rewrite measurements, units, place, or observation time
    never substitute browser or model weather data if either API call fails

define search_web with one required query string
searchWeb(query):
    validate and length-limit the query
    POST JSON to the same-origin /api/brave-search proxy
    never read or receive BRAVE_SEARCH_API_KEY in browser code
    validate the proxy response and its http/https result URLs
    return normalized titles, URLs, descriptions, and ages
formatWebSearchResult(result):
    deterministically render the submitted query and normalized result list
    preserve source titles, descriptions, URLs, and ages without model rewriting
    render an explicit no-results state when Brave returns no web results
```

## Python proxy modules

### `proxy/brave_client.py`

```text
read the API key only through constructor input from the server process
build a fixed Brave Web Search HTTPS URL with encoded query and bounded count
send the key only as X-Subscription-Token
validate JSON and normalize only title, url, description, and age
reject non-http(s) result URLs and never log or return the key
```

### `proxy/security.py`

```text
validate query type/length and count bounds
apply a thread-safe per-client sliding-window request limit
return stable client-safe errors without upstream credentials or bodies
```

### `proxy/app.py`

```text
serve only files rooted under web/; map / to web/index.html
handle POST /api/brave-search as the only API route
validate JSON media type and enforce the request body size limit
apply security headers to static and API responses
log structured request metadata without queries, response bodies, or credentials
translate validation, rate-limit, upstream, and internal failures to safe statuses
```

### `server.py`

```text
read BRAVE_SEARCH_API_KEY from the inherited environment
fail startup clearly when it is absent
bind to loopback on port 5500 by default and reject non-loopback hosts
create the proxy/static server and serve until interrupted
```

## `logger.js`

```text
define debug/info/warn/error levels
default sink writes one structured object per event to the matching console method
createLogger(sink): normalize timestamp, level, event, and supplied fields
allow replaceSink(newSink) without changing callers
```

## `context.js`

```text
buildContext(history, rollingSummary):
    treat absent or short history as a valid cold start
    use eight interaction slots instead of five
    if a summary exists:
        begin with one pinned system memory message
        append user/assistant messages from the last seven interactions
    otherwise:
        append user/assistant messages from up to the last eight interactions
    return API-ready messages without mutating history
```

## `summary.js`

```text
set SUMMARIZE_EVERY to 20
set SUMMARIZE_FROM to recursive (one-line switch supports raw)
shouldConsolidate(count): true only for positive multiples of 20
consolidate(history, priorSummary, count, endpoint):
    if cadence is not due, return prior summary unchanged
    select the last 20 raw interactions
    recursively prepend prior summary when configured and present
    call endpoint.summarize with the consolidation payload
    log trigger count, input size, returned length, and source mode
    on any failure: log warning and return the prior summary unchanged
```

## `chat.js`

```text
initialize(): load persisted state and expose an immutable snapshot
subscribe(listener): notify UI after state changes
onUserMessage(text):
    reject empty input and concurrent submissions
    build context from state before adding the new turn
    mark busy and notify UI
    call endpoint.chat(context, text)
    append interaction with assistant answer, optional thinking, id, and timestamp; increment counter
    atomically persist history, prior summary, and counter
    render the completed interaction immediately
    attempt non-fatal consolidation when count is divisible by 20
    if summary changes, persist the new summary
    clear busy and notify UI
deleteAll(): clear IndexedDB, reset all in-memory state, and notify UI
```

## `ui.js`

```text
bind controller state to semantic transcript, status, memory details, and composer
render cold-start welcome when history is empty
render user messages with textContent
render assistant answers through the safe Markdown DOM renderer
render endpoint thinking through the same renderer in a collapsed Thinking disclosure
submit on form submit; allow Shift+Enter for a newline
disable composer while generation is active and expose accessible busy status
on delete: require explicit confirmation, call controller.deleteAll, reset UI
keep latest message visible and update next-summary countdown
```

## `markdown.js`

```text
accept untrusted Markdown text and return a DocumentFragment
parse fenced code, headings, blockquotes, lists, tables, rules, and paragraphs
parse bold, emphasis, inline code, and http/https links inside text blocks
create every node with DOM APIs and assign user content through textContent
never assign generated text to innerHTML
reject unsafe link schemes and open valid links with noopener/noreferrer
```

## `index.html`

```text
render semantic header, transcript main, memory disclosure, composer, and confirm dialog
load only ui.js through a native type=module script
provide stable labels and test IDs for accessible automation
```

## `styles.css`

```text
define the approved true near-white, ink, slate, cobalt, and coral tokens
implement a centered single-column transcript with sticky composer
style user messages as cobalt surfaces and assistant messages as open bordered surfaces
include visible focus, busy, empty, hover, destructive, and dialog states
collapse cleanly to a mobile viewport and respect reduced motion
```
