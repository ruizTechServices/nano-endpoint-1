param(
  [string]$Url = "http://127.0.0.1:8088/"
)

$ErrorActionPreference = "Stop"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path -LiteralPath $chrome)) {
  throw "Chrome is required for this smoke test"
}

$port = 9333
$profile = Join-Path $env:TEMP ("orin-local-cdp-" + [guid]::NewGuid().ToString("N"))
$process = Start-Process -FilePath $chrome -ArgumentList @(
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--disable-background-mode",
  "--window-size=1440,1000",
  "--remote-allow-origins=*",
  "--remote-debugging-port=$port",
  "--user-data-dir=$profile",
  $Url
) -WindowStyle Hidden -PassThru

try {
  $targets = $null
  for ($attempt = 0; $attempt -lt 30 -and -not $targets; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    try {
      $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 2
    } catch {
      $targets = $null
    }
  }
  $target = $targets | Where-Object { $_.type -eq "page" -and $_.url -eq $Url } | Select-Object -First 1
  if (-not $target) { throw "Could not acquire the app page" }

  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $socket.ConnectAsync([uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  $script:commandId = 0
  $script:events = [System.Collections.Generic.List[object]]::new()

  function Invoke-Cdp {
    param([string]$Method, [hashtable]$Params = @{})
    $script:commandId += 1
    $id = $script:commandId
    $json = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Depth 20 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $segment = [ArraySegment[byte]]::new($bytes)
    $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null

    while ($true) {
      $stream = [IO.MemoryStream]::new()
      do {
        $buffer = New-Object byte[] 131072
        $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $stream.Write($buffer, 0, $received.Count)
      } while (-not $received.EndOfMessage)
      $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
      if ($message.id -eq $id) {
        if ($message.error) { throw ($message.error | ConvertTo-Json -Compress) }
        return $message.result
      }
      $script:events.Add($message)
    }
  }

  function Invoke-JavaScript {
    param([string]$Expression, [bool]$AwaitPromise = $false)
    $result = Invoke-Cdp "Runtime.evaluate" @{
      expression = $Expression
      awaitPromise = $AwaitPromise
      returnByValue = $true
    }
    if ($result.exceptionDetails) {
      throw $result.exceptionDetails.exception.description
    }
    return $result.result.value
  }

  Start-Sleep -Seconds 2
  Invoke-Cdp "Runtime.enable" | Out-Null
  Invoke-Cdp "Page.enable" | Out-Null
  Invoke-JavaScript "new Promise(resolve => document.readyState === 'complete' ? resolve(true) : addEventListener('load', () => resolve(true), {once:true}))" $true | Out-Null
  Invoke-JavaScript "new Promise((resolve, reject) => { const started=Date.now(); const check=() => document.querySelector('[data-message-input]') ? resolve(true) : Date.now()-started>5000 ? reject(new Error('App shell did not render')) : setTimeout(check,100); check(); })" $true | Out-Null

  $sendExpression = @"
(async () => {
  const input = document.querySelector('[data-message-input]');
  const form = document.querySelector('[data-composer]');
  input.value = 'Search the web for the official Python documentation.';
  form.requestSubmit();
  const started = Date.now();
  while (Date.now() - started < 45000) {
    const answers = document.querySelectorAll('.message--assistant .message__body');
    if (answers.length === 1) {
      const thinking = document.querySelector('.thinking-panel__content');
      return { answer: answers[0].textContent, messages: document.querySelectorAll('.message').length, thinkingLength: thinking?.textContent.length ?? 0 };
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for assistant response');
})()
"@
  $sent = Invoke-JavaScript $sendExpression $true
  if ($sent.answer.Length -lt 10) { throw "UI answer was unexpectedly short" }
  if (-not $sent.answer.Contains("Web search results") -or -not $sent.answer.Contains("Python Documentation")) {
    throw "The authoritative Brave Search result was not rendered"
  }
  if ($sent.thinkingLength -lt 1) { throw "Thinking output was not rendered" }
  $markdownExpression = @'
(async () => {
  const { renderMarkdown } = await import('/markdown.js');
  const host = document.createElement('div');
  host.append(renderMarkdown('### Heading\n\n**Bold** and `code`\n\n```python\nprint("safe")\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>bad()</script>'));
  return {
    headings: host.querySelectorAll('h3').length,
    strong: host.querySelectorAll('strong').length,
    codeBlocks: host.querySelectorAll('pre code').length,
    tables: host.querySelectorAll('table').length,
    scripts: host.querySelectorAll('script').length,
    preservesLiteralScript: host.textContent.includes('<script>bad()</script>')
  };
})()
'@
  $markdown = Invoke-JavaScript $markdownExpression $true
  if ($markdown.headings -ne 1 -or $markdown.strong -ne 1 -or $markdown.codeBlocks -ne 1 -or $markdown.tables -ne 1 -or $markdown.scripts -ne 0 -or -not $markdown.preservesLiteralScript) {
    throw "Markdown rendering or sanitization failed"
  }
  Invoke-JavaScript "document.querySelector('.thinking-panel').open = true" | Out-Null
  $screenshotPath = Join-Path $env:TEMP "orin-local-conversation.png"
  $capture = Invoke-Cdp "Page.captureScreenshot" @{ format = "png"; fromSurface = $true }
  [IO.File]::WriteAllBytes($screenshotPath, [Convert]::FromBase64String($capture.data))

  Invoke-Cdp "Page.reload" @{ ignoreCache = $true } | Out-Null
  Start-Sleep -Seconds 2
  $restored = Invoke-JavaScript "({messages:document.querySelectorAll('.message').length, answer:document.querySelector('.message--assistant .message__body')?.textContent ?? null})"
  if ($restored.messages -ne 2 -or $restored.answer.Length -lt 10) {
    throw "History did not survive page reload"
  }

  $deleteExpression = @"
(async () => {
  document.querySelector('[data-delete]').click();
  document.querySelector('[data-confirm-delete]').click();
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (document.querySelectorAll('.message').length === 0) {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('orin-local-chat', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const values = await new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readonly');
        const store = tx.objectStore('state');
        const requests = ['history', 'rollingSummary', 'interactionCount'].map(key => store.get(key));
        tx.oncomplete = () => resolve(requests.map(request => request.result));
        tx.onerror = () => reject(tx.error);
      });
      return {messages:0, values, cadence:document.querySelector('[data-cadence-status]').textContent};
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for delete');
})()
"@
  $deleted = Invoke-JavaScript $deleteExpression $true
  if ($deleted.values.Count -ne 3 -or ($deleted.values | Where-Object { $null -ne $_ }).Count -ne 0) {
    throw "IndexedDB was not fully cleared"
  }

  $runtimeErrors = @($script:events | Where-Object { $_.method -eq "Runtime.exceptionThrown" })
  $toolResponses = @($script:events | Where-Object {
    $_.method -eq "Runtime.consoleAPICalled" -and
    (($_.params.args | ConvertTo-Json -Depth 12 -Compress) -match 'tool.response')
  })
  if ($toolResponses.Count -lt 1) { throw "The web search tool did not execute" }
  [ordered]@{
    uiSend = "pass"
    liveAnswer = $sent.answer
    messageCount = $sent.messages
    thinkingPanel = "pass"
    thinkingLength = $sent.thinkingLength
    markdownRendering = "pass"
    markdownScriptSafety = "pass"
    reloadPersistence = "pass"
    deleteControl = "pass"
    indexedDbWipe = "pass"
    cadenceAfterDelete = $deleted.cadence
    runtimeExceptions = $runtimeErrors.Count
    liveToolResponses = $toolResponses.Count
    screenshot = $screenshotPath
  } | ConvertTo-Json -Depth 5
} finally {
  if ($socket) { $socket.Dispose() }
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
