## Best answer: use no VPS

  Because you are the only user and the Nano already runs Tailscale, the best option is:

  Your phone/laptop with Tailscale
            ↓ private HTTPS
  Tailscale Serve on the Orin Nano
            ↓
  FastAPI gateway on 127.0.0.1
            ↓
  Ollama + Brave + Time + Weather

  Cost: $0/month. Tailscale’s Personal plan is free, and Tailscale Serve exposes a local service only inside your tailnet—not publicly. Do not use Tailscale Funnel, which is intended for
  public exposure. Tailscale pricing (https://tailscale.com/pricing), Tailscale Serve documentation (https://tailscale.com/docs/reference/tailscale-cli/serve)

  A VPS would add latency, maintenance, and another failure point without making inference available when the Nano is offline.

  ## VPS comparison

  Current options within your budget:

   Provider                           Approximate cost    Resources                                                        Verdict
  ━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Tailscale Serve on Nano                          $0    Uses Nano                                                        Recommended
  ─────────────────────────  ──────────────────────────  ───────────────────────────────────────────────────────────────  ───────────────────────────────────────────────────────────
   Google Cloud Free Tier                           $0    One e2-micro, 30 GB disk, limited egress, selected US regions    Best free VPS fallback
  ─────────────────────────  ──────────────────────────  ───────────────────────────────────────────────────────────────  ───────────────────────────────────────────────────────────
   Oracle Always Free                               $0    Current docs indicate up to 2 ARM OCPUs and 12 GB total          Best free specifications, but capacity can be unavailable
  ─────────────────────────  ──────────────────────────  ───────────────────────────────────────────────────────────────  ───────────────────────────────────────────────────────────
   Vultr                                   $3.50/month    1 vCPU, 1 GB RAM, 10 GB disk                                     Best simple paid fallback
  ─────────────────────────  ──────────────────────────  ───────────────────────────────────────────────────────────────  ───────────────────────────────────────────────────────────
   DigitalOcean                               $4/month    1 vCPU, 512 MiB RAM, 10 GB disk                                  Easy, but memory is tight
  ─────────────────────────  ──────────────────────────  ───────────────────────────────────────────────────────────────  ───────────────────────────────────────────────────────────
   Fly.io                                Roughly $2–$5    Small Fly Machine plus storage/egress                            Viable but unnecessarily complex
  ─────────────────────────  ──────────────────────────  ───────────────────────────────────────────────────────────────  ───────────────────────────────────────────────────────────
   IONOS                      Advertised from $2/month    Depends on term/promotion                                        Check renewal and contract terms

  Sources: Google Cloud Free Tier (https://cloud.google.com/free/docs/free-cloud-features#compute), Oracle Always Free resources
  (https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), Vultr pricing (https://www.vultr.com/pricing/), DigitalOcean Droplet pricing
  (https://www.digitalocean.com/pricing/droplets), Fly.io pricing (https://fly.io/docs/about/pricing/).

  Fly.io no longer gives new accounts the old recurring free-machine allowance; that is limited to legacy organizations.

  ## Recommended implementation plan

  ### 1. Replace the current Python server

  Create a FastAPI application that:

  - Serves the existing web/ files.
  - Exposes same-origin routes:

  POST /api/chat
  POST /api/brave-search
  POST /api/current-time
  POST /api/current-weather
  GET  /api/health

  - Runs through Uvicorn on:

  127.0.0.1:8000

  The service must never bind to a public interface.

  ### 2. Move Orin requests server-side

  Change web/endpoint.js from:

  http://100.86.175.53:11435/api/chat

  to:

  /api/chat

  FastAPI will forward validated requests locally to:

  http://127.0.0.1:11435/api/chat

  It will enforce:

  - Model fixed to qwen3:1.7b.
  - Allowed message roles.
  - Maximum message and body sizes.
  - Fixed generation limits.
  - Exactly three allowed tools.
  - Request and upstream timeouts.
  - Safe response validation.

  ### 3. Proxy all tools server-side

  Move TimeAPI.io and Open-Meteo calls out of browser JavaScript.

  Browser → FastAPI → TimeAPI.io
  Browser → FastAPI → Open-Meteo
  Browser → FastAPI → Brave Search

  Benefits:

  - No browser CORS dependencies.
  - Smaller CSP connect-src.
  - Centralized validation and logging.
  - All external timeouts and errors handled consistently.

  The model can still select tools, but FastAPI executes them.

  ### 4. Preserve IndexedDB

  Do not change:

  - Database name.
  - Store name.
  - History key.
  - Summary key.
  - Interaction counter.
  - Eight-slot context.
  - Twenty-turn summary cadence.
  - Delete behavior.

  No server database is necessary for one user. History will remain device-specific.

  ### 5. Authentication and CSRF

  Use Tailscale as the primary authentication layer:

  - Only your tailnet identity and devices can reach the application.
  - Add a deny-by-default Tailscale ACL/grant.
  - Permit only your account/devices to access the Nano application.
  - Do not expose it through Funnel.

  FastAPI should additionally enforce:

  - Exact allowed Origin.
  - JSON-only mutating requests.
  - CSRF token or same-origin token header.
  - No wildcard CORS.
  - Trusted host validation.
  - Secure response headers.

  A separate username/password system is optional and probably unnecessary for one tailnet user.

  ### 6. Request protection

  Suggested limits:

  - Chat request body: 64 KiB.
  - Tool request body: 8 KiB.
  - Chat: 10 requests per minute.
  - Tools: 30 requests per minute.
  - Brave timeout: 15 seconds.
  - Time/weather timeout: 10 seconds.
  - Orin inference timeout: approximately 120 seconds.
  - Maximum one tool call per model response.

  Use structured logs with correlation IDs, but never log:

  - Brave credentials.
  - Authentication tokens.
  - CSRF tokens.
  - Complete sensitive headers.

  ### 7. Secret storage

  Rotate the currently exposed Brave credential first.

  On the Nano, store the replacement outside the repository in a root-owned systemd environment or credential file:

  /etc/orin-local/

  Permissions should be restricted to the service account. The service reads the credential at startup.

  ### 8. Run through systemd

  Create an unprivileged orin-local service account and a systemd unit that:

  - Starts Uvicorn.
  - Runs as a non-root user.
  - Restarts after failures.
  - Loads the Brave credential securely.
  - Binds only to 127.0.0.1:8000.
  - Applies systemd hardening options.
  - Starts after networking, Tailscale, Docker, and Ollama.

  ### 9. Restrict Ollama

  Change the Docker mapping from:

  0.0.0.0:11435 → 11434

  to:

  127.0.0.1:11435 → 11434

  Afterward, only FastAPI on the Nano can reach Ollama. Perform this carefully because it requires recreating or modifying the container configuration.

  ### 10. Enable private HTTPS

  Use Tailscale Serve to forward the Nano’s tailnet HTTPS hostname to:

  http://127.0.0.1:8000

  You would access it anywhere from a Tailscale-connected device using a URL similar to:

  https://orin-nano-44.YOUR-TAILNET.ts.net/

  Tailscale supplies the private HTTPS endpoint, so Caddy or Nginx is unnecessary.

  ### 11. Firewall

  For this design:

  - Deny unsolicited inbound traffic on the physical network interface.
  - Do not publicly open ports 80 or 443.
  - Do not publicly open port 11435.
  - Restrict SSH to Tailscale.
  - Permit the application only through tailscale0.
  - Verify SSH access through Tailscale before tightening firewall rules.

  ### 12. Deployment verification
  3. All three tools.
  4. Thinking and Markdown rendering.
  5. IndexedDB history after reload.
  6. Delete and IndexedDB wipe.
  7. Access from a phone over cellular with Tailscale enabled.
  8. Rejection when Tailscale is disabled.
  9. Rejection of cross-origin and oversized requests.
  10. Service recovery after Nano restart.
  11. Confirm ports 8000 and 11435 are not publicly reachable.
  12. Confirm logs and API responses never contain credentials.

  ## Fallback recommendation

  If you still want a VPS, use Google Cloud’s free e2-micro first. If the free tier is inconvenient, Vultr’s $3.50 plan is the strongest straightforward paid option under your budget.

  For your actual use case, however, FastAPI + systemd + Tailscale Serve directly on the Nano is simpler, safer, and completely free.
