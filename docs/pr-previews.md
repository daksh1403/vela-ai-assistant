# Pull request previews

[Back to README](../README.md) · [Deployment guide](deployment.md)

## How deployment works

Cloudflare Workers Builds is connected directly to this GitHub repository. Cloudflare
uses its own build token; no Cloudflare token is required in GitHub Actions.
GitHub Actions runs CI only. The former `PR Preview` and `Deploy Cloudflare` workflows
have been removed to avoid duplicate deployment pipelines and failed environment records.

## Connected Worker

The connected review Worker is **`vela-ai-assistant`**. The repository-root
[Wrangler configuration](../wrangler.jsonc) defines a stateless demo entry point,
compiled frontend assets, a custom build command, and the `previews` block required
by `wrangler preview`.

In the Cloudflare Worker build settings, use:

| Setting | Value |
| --- | --- |
| Root directory | `/` |
| Build command | `node scripts/build.mjs --ci --web-only` |
| Deploy command | `edge/node_modules/.bin/wrangler preview --config wrangler.jsonc` |
| Non-production branch deploy command | `edge/node_modules/.bin/wrangler preview --config wrangler.jsonc` |

Enable non-production branch builds for the branches you want to review. The older
`npx wrangler preview` command also finds this root config and runs its custom build;
using the installed binary avoids an extra Wrangler download.

## Review a pull request

1. Open or update a same-repository pull request.
2. Open its **Workers Builds: vela-ai-assistant** check.
3. Wait for Cloudflare's build to succeed.
4. Open the Preview URL shown in the Cloudflare build output.

Use the URL returned by Cloudflare rather than guessing a URL from a branch name.
Deployment success is separate from passing tests; inspect the **CI** checks too.
Cloudflare environment initialization occurs before repository build commands run.

## Demo behavior

The demo Worker has no provider key or Durable Object bindings. A visible notice
labels chat as a deterministic streamed response and images as a fixed sample.
The voice interface can be reviewed, but creating a live voice session returns a
preview-only error. Real API operations remain available on
[production](https://vela-assistant.dakshx.workers.dev).

Responses include `X-Vela-Preview: demo`, `Cache-Control: no-store`, and noindex headers.
The notice uses a same-origin stylesheet. The sample photograph is from
[Unsplash](https://images.unsplash.com/photo-1464822759023-fed622ff2c3b).

## Manual preview

Authenticate locally with Wrangler, then run from the repository root:

```bash
node scripts/build.mjs --web-only
edge/node_modules/.bin/wrangler preview --config wrangler.jsonc --name review-demo
```

Existing manually uploaded PR aliases on `vela-preview` remain available, but new
reviews use the direct Cloudflare integration. Those aliases and native branch
Previews are separate Cloudflare deployment mechanisms.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Missing `previews` block | Use the root `wrangler.jsonc`; `preview_urls` alone is insufficient |
| Missing frontend assets | Run the build command; it generates `web/dist` |
| Worker name mismatch | Use `vela-ai-assistant` for the root demo config |
| Initialization takes minutes | Inspect Cloudflare's build status; the repository code has not run yet |
| Old GitHub `preview` records show failures | These came from the removed token-based workflow; they are historical records, not the current Worker status |

See Cloudflare's [branch build guide](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
and [Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/).
