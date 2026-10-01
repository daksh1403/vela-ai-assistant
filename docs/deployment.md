# Deployment guide

[Back to README](../README.md) · [Build guide](build.md) · [PR previews](pr-previews.md)

## Deployment targets

| Target | Worker/configuration | Purpose |
| --- | --- | --- |
| Production | `vela-assistant` / `edge/wrangler.jsonc` | Real chat, image, and voice API with stored provider secret |
| PR review | `vela-preview` / `edge/wrangler.preview.jsonc` | Demo responses and stateless review URLs |
| Dashboard demo | `vela-ai-assistant` / root `wrangler.jsonc` | Native Cloudflare branch previews |

Deploying a review URL does not update production. Merging a PR updates its target
branch; only changes merged into the production build branch reach its next deployment.

## Production: Cloudflare Workers

From the repository root:

```bash
make build-check
cd edge
npx wrangler login
```

For first-time setup, enter a valid CallMissed key at Wrangler's prompt:

```bash
npx wrangler secret put CALLMISSED_API_KEY
```

The existing Worker retains its secret between deployments. Return to the root and deploy:

```bash
cd ..
make deploy-cloudflare
curl -fsS https://vela-assistant.dakshx.workers.dev/api/v1/health/ready
```

The Worker serves the compiled `web/dist` assets, handles `/api/*`, and uses a SQLite
Durable Object for rate limits. A fresh Worker requires provisioning its provider
secret as part of initial deployment; the commands above target the existing Worker.

## Cloudflare dashboard settings

Select a branch containing `scripts/build.mjs` and the intended UI. Use root directory `/`.

### Production Worker: `vela-assistant`

| Setting | Value |
| --- | --- |
| Build command | `node scripts/build.mjs --ci --web-only` |
| Deploy command | `edge/node_modules/.bin/wrangler deploy --config edge/wrangler.jsonc` |

### Demo Worker: `vela-ai-assistant`

| Setting | Value |
| --- | --- |
| Build command | `node scripts/build.mjs --ci --web-only` |
| Deploy command | `edge/node_modules/.bin/wrangler preview --config wrangler.jsonc` |
| Non-production branch deploy command | Same demo preview command |

Enable non-production branch builds when reviewing a feature branch. The demo config
includes the `previews` block required by `wrangler preview`. The installed binary
and explicit config path avoid downloading a second Wrangler at the repository root.

Cloudflare environment initialization happens before cloning and running the build.
Build script caching cannot reduce that initialization stage.

## Direct GitHub integration

Cloudflare is connected directly to the repository and manages its own build token.
GitHub Actions runs CI; no Cloudflare GitHub Actions secret is required. The connected
`vela-ai-assistant` Worker uses the root demo configuration for branch previews.

The separate production Worker `vela-assistant` uses `edge/wrangler.jsonc`. To enable
production builds directly in Cloudflare, connect that Worker to this repository and
use the production settings above. The existing production site can also be updated
with `make deploy-cloudflare` using local Wrangler authentication.

The former GitHub deployment workflows have been removed. See
[PR previews](pr-previews.md) for review instructions and troubleshooting.

## Docker on a VM

Install Docker Compose, point DNS to the host, and allow inbound ports 80 and 443.
In the host's private `.env`, set:

```dotenv
APP_ENV=production
APP_DOMAIN=your-domain
ACME_EMAIL=your-email
PUBLIC_APP_URL=https://your-domain
ALLOWED_ORIGINS=https://your-domain
```

Also supply `CALLMISSED_API_KEY` privately. Deploy and verify:

```bash
docker compose -f compose.yaml -f compose.prod.yaml up --build -d
curl -fsS https://your-domain/api/v1/health/ready
```

Caddy manages HTTPS and proxies the API. Only Caddy publishes ports. Updates can
cause brief downtime; automatic rollback is not configured.

## Post-deployment checks

1. Open the deployed UI on desktop and mobile and check both appearances.
2. Check `/api/v1/health/live` and `/api/v1/health/ready`.
3. When explicitly testing provider operations, verify chat streaming and image output.
4. Test microphone permission, audio playback, and session cleanup on a real device.
5. Inspect request IDs and structured logs when diagnosing API failures.
