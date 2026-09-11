# Temporary Render demo deployment

One Render **Web Service** serves the compiled React frontend and the Express API from a single
origin, against the existing Supabase database and the existing Gemini → Groq → deterministic
generation chain. Nothing about retrieval, embeddings, evidence or the data is changed by
deploying; the only additions are an explicit deployment mode, a shared demo credential and
static file serving.

```
Browser ── HTTPS ──▶ Render Web Service (https://<service>.onrender.com)
                       ├── React build served from frontend/dist
                       └── Express API at /api/*
                             ├─▶ Supabase PostgreSQL + pgvector
                             └─▶ Gemini / Groq
```

Frontend and API share one origin, so the browser needs no cross-origin permission, sends the
demo credential automatically to pages, API calls and the event stream alike, and no CORS
configuration is involved. There is no second Render service.

## This is not authentication

The demo gate is HTTP Basic authentication with **one shared credential**. There is no user
identity, no session, no authorization, no per-user audit trail and no account recovery. It exists
so a teacher or a hackathon judge can open one URL without the deployment being open to the
Internet. Do not describe it as authentication, and do not treat the deployment as production.
The absence of real authentication is a known, accepted limitation of this prototype.

## Render settings

| Setting | Value |
| --- | --- |
| Service type | Web Service |
| Branch | `main` |
| Root directory | *(blank — the repository root)* |
| Runtime | Node |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm run start -w @machine-memory/backend` |
| Health check path | `/api/health` |

`--include=dev` is required, not optional. Render sets `NODE_ENV=production`, and npm then omits
`devDependencies` — which is where TypeScript and Vite live, so a plain `npm ci` produces a build
that cannot compile. Both commands above were run locally with `NODE_ENV=production` set.

The build runs the workspaces in order (`packages/shared`, `backend`, `frontend`) and produces
`backend/dist/index.js` and `frontend/dist/`. The start command runs the compiled backend, which
serves the compiled frontend from the same process.

## Environment variables

Set these in the Render dashboard. Never commit any value.

| Name | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `HOST` | `0.0.0.0` | Render cannot reach a loopback bind |
| `DEMO_DEPLOYMENT` | `true` | The only way to start outside loopback; everything below becomes required |
| `PUBLIC_ORIGIN` | `https://<service>.onrender.com` | Exact https origin, no path, query or trailing slash content |
| `DEMO_BASIC_AUTH_USER` | *(choose)* | Shared demo username |
| `DEMO_BASIC_AUTH_PASSWORD` | *(choose)* | Shared demo password, **12 characters minimum** |
| `DATABASE_URL` | *(secret)* | Existing Supabase session pooler URI — do not create a Render database |
| `GEMINI_API_KEY` | *(secret)* | |
| `GROQ_API_KEY` | *(secret)* | Secondary generation only; never embeddings |
| `NODE_VERSION` | `22.22.0` | See below |

Optional, matching `.env.example` defaults if you want them explicit: `DATABASE_CA_PATH`,
`GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `GROQ_MODEL`,
`AI_GENERATION_PROVIDER`.

**`PORT` is supplied by Render.** Do not set it and do not hardcode it; the server reads
`process.env.PORT` and falls back to 3001 only for local development.

No secret may ever be exposed to the browser. There is no `VITE_` variable for any of them, and
the built bundle contains none.

### Node version

`backend/dist/index.js` imports `@machine-memory/shared`, whose package entry point is TypeScript
source. Node runs it through built-in type stripping, which is **enabled by default only from Node
22.18.0** (and 23.6.0 / 24.x). Node 22.12–22.17 would fail to start the compiled server, so
`engines` is bounded at `>=22.18.0 <25` and `NODE_VERSION` is pinned. Render's own guidance is to
give a version range an upper bound rather than let it float.

## What the demo mode changes, and what it does not

`DEMO_DEPLOYMENT=true` is the only switch. Without it nothing changes: the server refuses to start
in production, refuses to bind anywhere but loopback, serves no frontend and asks for no
credential. With it, startup **fails closed** if the public origin or either credential is missing
or unusable.

- **Host** — accepted values become the configured public host plus loopback. Loopback stays
  permitted for Render's health probe and local smoke tests; it grants nothing, because every path
  but the health check still needs the credential.
- **Origin** — a browser `Origin` header must parse to exactly `PUBLIC_ORIGIN`. Comparison is on
  the parsed origin (scheme, host, port), never a substring, so neither
  `https://<service>.onrender.com.example.com` nor `https://evil.example/?x=<service>.onrender.com`
  matches. There is no wildcard and no allowlist of convenience origins.
- **Cross-site** — a request carrying `Sec-Fetch-Site: cross-site` is still rejected.
- **Credential** — checked before body parsing, rate limiting and every route, so an
  unauthenticated request costs one hash comparison and never reaches the database or a provider.
  Username and password are compared in constant time over SHA-256 digests, and both comparisons
  always run so a wrong username is not measurably faster to reject than a wrong password.
  Unauthenticated requests get `401` with
  `WWW-Authenticate: Basic realm="Machine Memory Demo", charset="UTF-8"`. The `Authorization`
  header is never logged and no credential appears in any response.
- **Static files** — only `frontend/dist` is served. A browser GET that is not under `/api/` and
  accepts HTML falls back to `frontend/dist/index.html`; everything else does not. An unknown
  `/api/*` path stays an API `404` with an API error body, never a page.

Rate and cost controls are unchanged: 120 API requests/minute overall, **10 AI requests/minute**,
at most two expensive jobs per instance, a 500-operation model allowance per process, and the
ten-minute provider cooldown. A demonstration that asks questions faster than ten a minute will
see `429`; that is deliberate.

## Health check

`GET /api/health` is the only path exempt from the credential, because Render must reach it. It
runs one `SELECT 1`, calls no model provider, mutates nothing and returns no secret:

```json
{"status":"ok","service":"machine-memory","database":"connected","llm":"configured_unverified","phase":"mvp"}
```

`"llm":"configured_unverified"` means a key is present, not that a provider answered.

## Verifying a deployment

After the first deploy, from your own machine:

```bash
curl -s https://<service>.onrender.com/api/health          # 200, no credential
curl -s -o /dev/null -w '%{http_code}\n' https://<service>.onrender.com/   # 401
curl -s -u '<user>:<password>' https://<service>.onrender.com/ | head -c 40 # <!doctype html>
```

Then open the URL in a browser, enter the shared credential once, and confirm the investigation
workspace loads and a copilot question returns cited evidence.

## Known limitations of this deployment

- One shared credential, not authentication. Anyone holding it can write assets, import data,
  upload documents and spend model quota. Rotate it in the Render dashboard after the demo and
  suspend the service when it is no longer needed.
- Render's free tier idles an inactive service; the first request after an idle period pays a cold
  start on top of the normal first-request cost.
- Free-tier Gemini and Groq quotas are finite. When both are exhausted the service still answers
  from the deterministic path with real retrieved evidence and citations, without model prose.
- `trust proxy` is set to one hop in demo mode so rate limiting sees the real client address.
  That is correct behind Render and wrong anywhere the service is exposed without a proxy.
