# Machine Memory

A local wind-turbine investigation prototype combining structured history, semantic reference
retrieval and cited evidence. The investigation workspace, Data Hub, fleet view, Scenario Lab
and simulated event feed are implemented. It does not control equipment or authorize maintenance.

## Run locally

Requires Node 22.12 or newer. From the repository root:

```bash
npm ci
# For a new checkout only: copy .env.example to .env and fill backend credentials locally.
npm run dev
```

Open http://127.0.0.1:5173; Vite proxies `/api` to the backend at 127.0.0.1:3001.
Use only the dedicated Machine Memory database. Never point this project at an E-Set
production database. Root `.env` is ignored; secrets must never use a `VITE_` prefix.
For schema/seed details see [database notes](docs/DATABASE.md); migration and reset commands
are operator actions, not necessary startup steps for an already populated database.

Gemini provides embeddings; generation can fall back to Groq, then deterministic answers.
A configured key is not a successful model health check. Missing services are reported as
degraded. Current configuration defaults live in `.env.example` and `backend/src/config.ts`.

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

These offline gates do not verify the live database, providers or browser. Consult the
[checkpoint table](PROJECT_CONTEXT.md) and [remediation ledger](docs/REMEDIATION_STATUS.md)
for exactly which live checks ran and which remain open.

## Local limits and remaining boundaries

The server has no login and stays on loopback, rejects unapproved Host/Origin headers,
and refuses production startup unless the temporary demo deployment is explicitly requested
(see [Render deployment](docs/DEPLOYMENT_RENDER.md); its HTTP Basic gate is one shared
credential for a teacher or hackathon demonstration and is **not** authentication — no user
identity, no session, no authorization). Otherwise keep Internet access blocked. At most two expensive jobs
run per app instance, with no queue; overload returns 503. A shared allowance of 500 logical
model operations lasts until app restart. It is not a dollar or per-user billing cap.

Reset coordination remains unresolved (P2-10). Stop the app, simulator and other writers and
wait for background jobs to finish before considering the operator reset. Inspect its dry-run
and selected origins first; it deletes user data and can leave derived asset status stale.
Do not run it as routine startup or over data you intend to keep. Full-demo and deployment
readiness are not established by the passing unit suite.

## Real public wind turbine data

Alongside the synthetic demonstration farm, Machine Memory holds **genuine public operational
data**: 1,172 real event records from two Penmanshiel turbines, February 2023.

Source: Cubico Sustainable Investments Ltd, "Penmanshiel wind farm data" v3, Zenodo record
16807304, CC-BY-4.0.

```bash
npm run data:penmanshiel                       # 14 real turbine identities
npm run data:penmanshiel -- --events           # real event history for PEN-T01 and PEN-T02
```

Both are idempotent. The site appears as **Penmanshiel Wind Farm · PUBLIC DATA**, kept entirely
separate from the fictional Demonstration Wind Farm, and every imported row carries
`record_origin = public_data`.

The dataset has operational events and **no** work orders, root causes or repair records. That gap
is preserved: ask how a real event was solved and Machine Memory says a verified resolution is not
present, rather than inventing one. Severity is mapped conservatively and `critical` is
unreachable, because the published data has no such class.

Nothing is trained on this data. Structured rows are queried in SQL; reviewed public references, user-uploaded documents and saved-resolution narratives can
be embedded with their original provenance. See `docs/PENMANSHIEL_DATA.md`.
