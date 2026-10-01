# Build Vela

From the repository root, run `make build` or `node scripts/build.mjs`. The script
also works via its absolute path from other directories.

The build installs missing dependencies (and reinstalls when a cached package lock
changes), then compiles `web/dist` and `edge/dist` concurrently. Existing installed
dependencies are reused. Inputs include source, assets, package files, TypeScript/Vite
configuration, the build script, Node version, and Vite build environment variables.
A content fingerprint of generated output catches missing or modified artifacts.
Unchanged builds reuse the verified output. Cache metadata lives in ignored `.cache/build`.

- `make build-force`: regenerate outputs using installed dependencies.
- `make build-check`: build and validate production Cloudflare packaging.
- `node scripts/build.mjs --ci`: clean locked installs and force both builds.
- `node scripts/build.mjs --ci --web-only`: build the UI and install Wrangler concurrently for PR previews.

Build caching does not replace tests. Run `make test` and `make lint` for checks.
GitHub CI still runs frontend/backend/edge tests, types, lint, audits, container
checks, and security scans. Cloudflare builds and deploys previews through its direct GitHub integration.
A review preview is not a passing-CI claim.

## Deployment

See [the deployment guide](deployment.md) for production and demo dashboard settings.
Cloudflare environment initialization happens before this build script runs.

## Frontend loading

The chat screen loads its Markdown renderer when sending a message; completed
messages are memoized so streaming does not repeatedly parse conversation history.
The voice room loads LiveKit only after microphone permission is granted and before
creating a paid session. Fonts are local WOFF2 files, preloaded from the same host,
with bundled OFL licenses and a long-lived cache policy.

Local measurements on this machine (not a CI or network benchmark):

| Check | Before | After |
| --- | --- | --- |
| Full build command | 5.44 s | about 3.3 s |
| Unchanged repeat build | rebuilt | 0.07 s wall time |
| Chat screen JS | 164.37 KB | 6.38 KB |
| Voice room JS | 569.58 KB | 7.96 KB |

The Markdown and LiveKit payloads still download when used. The initial React shell
is approximately 245 KB. LiveKit still emits Vite’s large-chunk warning; deferring it
makes the voice room open quickly without pretending that dependency disappeared.
