# Pull request previews

Every same-repository PR gets a stable Cloudflare review URL:
`https://pr-<number>-vela-preview.dakshx.workers.dev`.

The **PR Preview** workflow checks out the exact PR head, builds the frontend,
installs Wrangler, and uploads a version to the dedicated `vela-preview` Worker,
probes it, and updates one bot comment with the URL and commit SHA. GitHub also
shows the preview as a deployment. New commits update the same URL. The separate CI workflow runs all tests and static/security checks. Production
`vela-assistant` is not deployed by this workflow. Fork PRs do not receive credentials.

## One-time setup

1. Create the preview Worker from `edge/` after building `web/`:
   `npx wrangler deploy --config wrangler.preview.jsonc`.
2. Add repository secret `CLOUDFLARE_API_TOKEN`: a Cloudflare API token scoped to
   the account with **Account / Workers Scripts / Edit** and **Account / Account Settings / Read**.
   Use GitHub’s secret UI or `gh secret set CLOUDFLARE_API_TOKEN` and paste privately.
   Do not use Wrangler’s expiring local OAuth credential in CI.
3. Set repository variable `CLOUDFLARE_ACCOUNT_ID` to your Cloudflare account ID.
4. Open or update a PR. Inspect the **PR Preview** action and its bot comment.

## Preview behavior

The preview Worker has no provider key, Durable Objects, or production bindings.
It injects a visible preview notice into HTML. Chat returns a deterministic
streamed Markdown answer. Images return a fixed sample photograph, enabling
preview, regenerate, and download review without paid image generation. Voice
shows its real interface and microphone permission states; session creation returns
an explicit preview-only error. Production continues to use the real API.

Preview responses carry `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`,
and `X-Vela-Preview: demo`. The preview notice is styled by a same-origin stylesheet
so the existing CSP remains intact. The sample photograph is from
[Unsplash](https://images.unsplash.com/photo-1464822759023-fed622ff2c3b).

On PR closure, GitHub deployments become inactive. Cloudflare version aliases
remain available for review; Cloudflare retains the 1,000 most recent aliases.
These are version aliases on a stateless review Worker, not isolated backend
Previews. This keeps review deployment independent of production’s Durable Objects.

For a manual preview:

```bash
cd web
npm ci && npm run build
cd ../edge
npm ci
npx wrangler versions upload --config wrangler.preview.jsonc --preview-alias pr-123
```

See Cloudflare’s [version URL documentation](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/).
