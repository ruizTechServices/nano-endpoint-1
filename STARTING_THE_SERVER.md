# Starting the server with cloud save enabled

`server.py` reads `BRAVE_SEARCH_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, and
`SUPABASE_SERVICE_ROLE_KEY` from the process environment at startup. It does
**not** read `.env.local` itself — if you launch `python server.py` directly,
none of those variables exist in the process, cloud save silently disables
itself, and every `/api/save-history` request returns `503 Cloud save is not
configured`. Search still works because `BRAVE_SEARCH_API_KEY` is required
and checked separately (missing it is a hard startup failure).

So `.env.local` must be loaded into the shell **before** `python server.py`
runs, so the values get inherited by the child process.

## Bash / Git Bash

```bash
set -a
source .env.local
set +a
python server.py
```

`set -a` auto-exports every variable assigned from then on; `source
.env.local` assigns them; `set +a` turns auto-export back off so later
commands in the same shell aren't affected.

## PowerShell

```powershell
Get-Content .env.local | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  if ($_ -match '^([^=]+)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
python server.py
```

PowerShell has no `source .env`-style builtin for this format, so the
snippet parses `.env.local` line by line (skipping blanks/comments) and sets
each `KEY=VALUE` into the current process's environment before launching the
server.

## How to tell it worked

Hit the save endpoint with an empty body:

```bash
curl -s http://127.0.0.1:5500/api/save-history -X POST -H "Content-Type: application/json" -d '{}'
```

- `{"error":"Cloud save is not configured"}` (503) → env vars weren't loaded.
- Any other validation error (e.g. `"conversationId must be a non-negative
  integer"`) → cloud save is active; the request just needs a real payload.
