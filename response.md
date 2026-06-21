# Skip the VPS: Run Your Orin Nano Securely, for Free

*A field guide to exposing a single-user AI gateway without renting a server you don't need*

---

> **TL;DR** — Because you're the only user and the Nano already runs Tailscale, you don't need a VPS at all. Wire everything through Tailscale Serve and a hardened FastAPI gateway, and the whole stack costs **$0/month**.

---

## The Verdict, Up Front

Here's the architecture that wins:

```text
Your phone/laptop with Tailscale
          ↓ private HTTPS
Tailscale Serve on the Orin Nano
          ↓
FastAPI gateway on 127.0.0.1
          ↓
Ollama + Brave + Time + Weather
```

**Cost: $0/month.**

Tailscale's Personal plan is free, and **Tailscale Serve** exposes a local service only *inside your tailnet* — never publicly. (Don't reach for **Tailscale Funnel**; that's the tool meant for public exposure, and it's the wrong fit here.)

A VPS would only add latency, maintenance, and one more thing that can break — without making inference available when the Nano itself is offline anyway.

*Sources: [Tailscale pricing](https://tailscale.com/pricing) · [Tailscale Serve docs](https://tailscale.com/docs/reference/tailscale-cli/serve)*

---

## If You Still Want a VPS: The Lineup

Here's how the budget options stack up, for comparison:

| Provider | Approx. Cost | Resources | Verdict |
| --- | --- | --- | --- |
| **Tailscale Serve on Nano** | **$0** | Uses the Nano you already own | ⭐ Recommended |
| Google Cloud Free Tier | $0 | One e2-micro, 30 GB disk, limited egress, select US regions | Best free VPS fallback |
| Oracle Always Free | $0 | Up to 2 ARM OCPUs, 12 GB total (per current docs) | Best specs — but capacity can vanish |
| Vultr | $3.50/mo | 1 vCPU, 1 GB RAM, 10 GB disk | Best simple paid fallback |
| DigitalOcean | $4/mo | 1 vCPU, 512 MiB RAM, 10 GB disk | Easy, but memory is tight |
| Fly.io | ~$2–$5 | Small Fly Machine + storage/egress | Workable, unnecessarily complex |
| IONOS | From $2/mo (advertised) | Depends on term/promotion | Check renewal terms carefully |

> ⚠️ **Heads-up:** Fly.io no longer gives new accounts the old recurring free-machine allowance — that perk is now limited to legacy organizations.

*Sources: [Google Cloud Free Tier](https://cloud.google.com/free/docs/free-cloud-features#compute) · [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) · [Vultr pricing](https://www.vultr.com/pricing/) · [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets) · [Fly.io pricing](https://fly.io/docs/about/pricing/)*

---

## The Build: A 12-Step Implementation Plan

### 1 · Replace the current Python server

Stand up a FastAPI application that:

- Serves the existing `web/` files
- Exposes same-origin routes:
  ```text
  POST /api/chat
  POST /api/brave-search
  POST /api/current-time
  POST /api/current-weather
  GET  /api/health
  ```
- Runs through Uvicorn on `127.0.0.1:8000`

> 🚫 The service must **never** bind to a public interface.

---

### 2 · Move Orin requests server-side

Change `web/endpoint.js` from:

```text
http://100.86.175.53:11435/api/chat
```

to:

```text
/api/chat
```

FastAPI forwards validated requests locally to `http://127.0.0.1:11435/api/chat`, and enforces:

- Model fixed to `qwen3:1.7b`
- Allowed message roles only
- Maximum message and body sizes
- Fixed generation limits
- Exactly three allowed tools
- Request and upstream timeouts
- Safe response validation

---

### 3 · Proxy all tools server-side

Pull TimeAPI.io and Open-Meteo calls out of browser JavaScript entirely:

```text
Browser → FastAPI → TimeAPI.io
Browser → FastAPI → Open-Meteo
Browser → FastAPI → Brave Search
```

**Why this is worth it:**

- No browser CORS dependencies
- Smaller CSP `connect-src`
- Centralized validation and logging
- Consistent handling of all external timeouts and errors

The model still *chooses* tools — FastAPI is the one that actually *executes* them.

---

### 4 · Preserve IndexedDB — touch nothing

Leave these exactly as they are:

- Database name
- Store name
- History key
- Summary key
- Interaction counter
- Eight-slot context
- Twenty-turn summary cadence
- Delete behavior

No server database is necessary for one user — history stays device-specific.

---

### 5 · Authentication and CSRF

Let Tailscale do the heavy lifting as your primary auth layer:

- Only your tailnet identity and devices can reach the app
- Add a **deny-by-default** Tailscale ACL/grant
- Permit only your account/devices to access the Nano application
- Do **not** expose it through Funnel

FastAPI adds a second layer on top:

- Exact allowed `Origin`
- JSON-only mutating requests
- CSRF token or same-origin token header
- No wildcard CORS
- Trusted host validation
- Secure response headers

A separate username/password system is optional — and probably overkill for one tailnet user.

---

### 6 · Request protection

| Limit | Value |
| --- | --- |
| Chat request body | 64 KiB |
| Tool request body | 8 KiB |
| Chat rate | 10 req/min |
| Tools rate | 30 req/min |
| Brave timeout | 15 s |
| Time/weather timeout | 10 s |
| Orin inference timeout | ~120 s |
| Tool calls per response | 1 max |

Use structured logs with correlation IDs — but **never** log:

- Brave credentials
- Authentication tokens
- CSRF tokens
- Complete sensitive headers

---

### 7 · Secret storage

🔑 **First thing: rotate the currently exposed Brave credential.**

On the Nano, store the replacement *outside the repository*, in a root-owned systemd environment or credential file:

```text
/etc/orin-local/
```

Restrict permissions to the service account. The service reads the credential at startup.

---

### 8 · Run through systemd

Create an unprivileged `orin-local` service account and a systemd unit that:

- Starts Uvicorn
- Runs as a non-root user
- Restarts after failures
- Loads the Brave credential securely
- Binds only to `127.0.0.1:8000`
- Applies systemd hardening options
- Starts after networking, Tailscale, Docker, and Ollama

---

### 9 · Restrict Ollama

Change the Docker mapping from:

```text
0.0.0.0:11435 → 11434
```

to:

```text
127.0.0.1:11435 → 11434
```

Now only FastAPI on the Nano can reach Ollama. ⚠️ Do this carefully — it requires recreating or modifying the container configuration.

---

### 10 · Enable private HTTPS

Use Tailscale Serve to forward the Nano's tailnet HTTPS hostname to `http://127.0.0.1:8000`.

You'll reach it from anywhere on a Tailscale-connected device via a URL like:

```text
https://orin-nano-44.YOUR-TAILNET.ts.net/
```

Tailscale supplies the private HTTPS endpoint — no Caddy or Nginx required.

---

### 11 · Firewall

- Deny unsolicited inbound traffic on the physical network interface
- Do **not** publicly open ports 80 or 443
- Do **not** publicly open port 11435
- Restrict SSH to Tailscale
- Permit the application only through `tailscale0`
- ✅ Verify SSH access through Tailscale *before* tightening firewall rules

---

### 12 · Deployment verification checklist

- [ ] All three tools work
- [ ] Thinking and Markdown rendering work
- [ ] IndexedDB history survives a reload
- [ ] Delete clears IndexedDB
- [ ] Accessible from a phone over cellular with Tailscale enabled
- [ ] Rejected when Tailscale is disabled
- [ ] Cross-origin and oversized requests are rejected
- [ ] Service recovers after a Nano restart
- [ ] Ports 8000 and 11435 are **not** publicly reachable
- [ ] Logs and API responses never contain credentials

---

## The Bottom Line

If you still want a VPS as a fallback, start with Google Cloud's free e2-micro. If that's inconvenient, Vultr's $3.50 plan is the strongest straightforward paid option in budget.

> **But for your actual use case:** FastAPI + systemd + Tailscale Serve, running directly on the Nano, is simpler, safer, and completely free.
