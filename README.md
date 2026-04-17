# Cloudflare Worker DDEV

This Cloudflare Worker lets one browser session temporarily route a proxied hostname
to a local tunnel after an explicit opt-in.

## Flow

1. Visit `https://app.example.com/?cf_local_debug=1` from the allowed IP.
2. The Worker sets a short-lived cookie and redirects back.
3. While the cookie is present and the IP still matches, requests are proxied to
   `DEBUG_ORIGIN`.
4. Visit `https://app.example.com/?cf_local_debug=0` to turn it off immediately.

Everyone else continues to hit the normal origin. If the required secrets are not
configured the worker passes all traffic through without interfering.

## Configure

Secrets are set via the CLI and stored encrypted by Cloudflare. Nothing sensitive lives
in `wrangler.jsonc` or source control. Secrets are never overwritten by deploys.

### Set secrets

```bash
# Required
npx wrangler secret put DEBUG_ORIGIN   # Full URL including scheme, e.g. https://abc123.trycloudflare.com
curl -s https://api.ipify.org | npx wrangler secret put DEBUG_IP  # Pipes your current public IP directly

# Optional — defaults used if not set (cf_local_debug / 3600)
npx wrangler secret put DEBUG_COOKIE
npx wrangler secret put DEBUG_MAX_AGE
```

Each command will prompt you to enter the value (except the piped IP command).
To update a secret later, run the same command again.

### Update IP (when your public IP changes)

```bash
curl -s https://api.ipify.org | npx wrangler secret put DEBUG_IP
```

> [!WARNING]
> Setting `DEBUG_IP` to `0.0.0.0` disables IP filtering entirely — **any** visitor who
> knows the activation URL can enable the debug tunnel. Only use this temporarily and in
> environments where that is acceptable.

### Routes

There is no CLI command to set routes independently, so they are managed via the
Cloudflare dashboard to avoid hardcoding them in `wrangler.jsonc`. After deploying,
add the route under **Workers & Pages** → your Worker → **Settings** →
**Domains & Routes**, e.g. `demo.devhosting.com.ar/*`.

## Run

```bash
npm install

# Deploy (secrets are set separately via wrangler secret put — see Configure above)
npm run deploy
```
> [!TIP]
> If things aren't working as expected, check the worker logs under **Workers & Pages** →
> your Worker → **Logs**. The worker emits debug messages for IP mismatches, invalid
> configuration values, and every request routed to the tunnel.

## Notes

- **Image passthrough** — requests for common image extensions (`.png`, `.jpg`, `.gif`,
  `.svg`, `.webp`, `.ico`, `.bmp`, `.tiff`, `.avif`) bypass the worker entirely and go
  straight to the normal origin, even when the debug cookie is active.
- **IP check on enable** — the debug cookie is only set if the request comes from
  `DEBUG_IP`. All other visitors are unaffected. Set `DEBUG_IP` to `0.0.0.0` to allow
  any IP (see warning above).
- **Secure cookie** — the toggle cookie is set with `HttpOnly`, `Secure`, and
  `SameSite=None` so it works across origins.
- **Redirect handling** — the proxied request uses `redirect: "manual"` so redirects
  from the tunnel are forwarded as-is rather than followed internally.
- **`x-forwarded-host` omitted** — some strict tunnel providers (e.g. ngrok, Cloudflare
  Tunnel) drop connections when `x-forwarded-host` doesn't match the SNI hostname, so
  it is intentionally not forwarded.
