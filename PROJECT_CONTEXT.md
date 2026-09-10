# Machine Memory — authoritative project context

## Goal

Machine Memory: An Asset-Conditioned Retrieval-Augmented Generation (RAG) System for Wind Turbine Maintenance Intelligence. Build a real asset-history product for a university demonstration, not a generic PDF chatbot. **The hybrid retrieval and synthesis pipeline is now implemented and the investigation workspace is complete.** What remains open is live verification against a real database and a real model account; see the checkpoint table below for exactly what was and was not executed.

## Current architecture

npm workspaces, React/Vite/TypeScript, Express/TypeScript/Zod, Supabase PostgreSQL with pgvector1536, backend-owned `pg` SQL. OpenAI runtime contract gpt-5.6-terra via Responses API; offline embeddings text-embedding-3-small. Generic asset model with fictional wind-turbine seed. No Docker, microservices, LangChain or machine-control APIs.

## Authoritative contracts

- docs/API_CONTRACT.md + packages/shared/src/index.ts: frozen v1 wire shapes, routes, limits, errors, intents, provenance and semantic-pending response.
- supabase/migrations/20260909202010_machine_memory.sql: schema; docs/DATABASE.md explains constraints and verification queries.
- docs/SEED_CONTRACT.md: synthetic fixtures and expected counts.
- docs/DATA_RAG_HANDOFF.md + scripts/rag/manifest.ts: local knowledge JSON contract.
- docs/EVIDENCE_STRENGTH.md + backend/src/rag.ts: deterministic scoring and safety/citation foundation.
- docs/AGENT_OWNERSHIP.md: paths, branches/worktrees, acceptance criteria and integration sequence.

No implementation agent may silently change these contracts. Current repository files outrank earlier conversation proposals.

## Database status

All 12 tables authored with UUIDs, mandatory provenance, timestamps, pgvector(1536), indexes, constraints, same-asset foreign keys, RLS and revoked anon/authenticated privileges. The migration was **not modified** in this phase: no schema defect was found, so none was invented.

No dedicated Machine Memory Supabase target is configured and **no live database has been reached at any point**. Migration and seed SQL remain unexecuted and unverified against a running PostgreSQL. Advisors, rollback, foreign-key, RLS and imported-count checks are all still pending and must be run by the operator.

This has a direct consequence for how the tests should be read: the retrieval tests exercise the pipeline against a fake query surface that applies the *real bind parameters* to fixture rows. They prove the retrieval scope is right — current event excluded, selected asset excluded from fleet matches, correct 30-day window, correct authority filters — but they do not prove the SQL text executes on PostgreSQL. Two constructs in particular need a live run: the schema-qualified vector operator `OPERATOR(extensions.<=>)` and the `union all` change-window query.

## Data provenance

Every seed record is synthetic_demo. Demo site, OEM, model and fault codes are fictional; not Zephyr or Penmanshiel. Server-created resolutions force user_demo. `validated=true` is a demo user's assertion only.

Genuinely public and verified: `data/raw/Penmanshiel_WT_static.csv`, retrieved from Zenodo record 16807304 (v3, CC BY 4.0, Cubico), MD5 `c4cd4191234c1a67a391fe5d2978256b` matching the publisher's checksum. 14 real turbine identities with coordinates and ratings. Also prepared: three reviewed public reference manifests paraphrased from OSHA and NREL sources read directly from their publishers.

Not done, and not to be described otherwise: no public SCADA or event history exists anywhere in this project; the Penmanshiel importer has never been run against a database; and the reference corpus has never been embedded or inserted. See DATA_PROVENANCE.md and docs/SOURCE_MANIFEST.md.

## RAG design and actual status

Target: intent → developer-written structured SQL/counts → asset/metadata-filtered vectors → evidence fusion/authority → deterministic safety/strength → Responses synthesis → schema/citation/grounding validation. Counting remains SQL-only; evidence provenance and applicability survive all stages.

Implemented: intent-specific structured retrieval for all seven frozen intents with SQL-computed recurrence counts, occurrence timestamps and bounded change windows; pgvector cosine search combined with PostgreSQL keyword ranking; deterministic evidence fusion where authority outranks similarity; backend-assigned evidence strength; grounded synthesis through the Responses API over a normalized evidence bundle; strict model-output parsing with bounded repair; citation validation with a deterministic fallback answer; and a two-stage safety gate (pre-retrieval refusal for prohibited requests, post-retrieval insufficiency when no authoritative reference was retrieved).

`INVESTIGATION_NOT_IMPLEMENTED` is retired. With no database configured, investigate returns 503 `DATABASE_NOT_CONFIGURED` rather than a fabricated answer.

Not verified: **no investigation has ever run against a real database or a real model**, because neither was reachable. The pipeline has been executed end to end against a fake query surface and fake model responses only. Citation existence remains an allowlist check, not semantic entailment — a finding can cite a real record and still misread it.

Resolution POST commits SQL, appears in the timeline immediately, and returns STRUCTURED_SAVED_SEMANTIC_PENDING. Semantic indexing now runs as a best-effort follow-up *after* the response: it can never roll back the committed record, and its success is deliberately not reported to the client, because the contract's status enum would then be lying about work that may still be in flight.

## Security invariants

No frontend secrets; only backend API; RLS closed to browser; parameterized SQL; strict request limits/validation; AI rate limiting; Helmet; loopback Host/Origin restrictions; production startup blocked absent authentication; verified remote DB TLS including optional CA; HTTP ingestion always disabled. No execution of model SQL/code or machinery commands. All source text untrusted; demo provenance never elevates authority. Read SECURITY.md before extending.

## Contract changes

Exactly one, documented as Amendment 1.1 in docs/API_CONTRACT.md: `HealthResponse.phase` widened from `'foundation'` to `'foundation' | 'mvp'`, with the server reporting `'mvp'`. A health field still saying `foundation` would have misreported completion. Shared types, backend, contract document and HTTP test were updated together. Nothing else in the frozen contract changed.

## Remaining work

Operator, before the demonstration: provision a dedicated Supabase project, apply the migration, run `npm run db:seed`, run `npm run data:penmanshiel`, add an OpenAI key, run `npm run rag:ingest:corpus`, then walk DEMO_SCRIPT.md end to end. Until the corpus is ingested, technical-guidance and safety questions correctly return INSUFFICIENT.

Verification still owed: `npm ci`, lint, typecheck, build and the full vitest run in an environment with registry access; live SQL execution of the retrieval queries; a real Responses API call; and browser interaction QA of the workspace. None of these were possible in this session.

Deferred by choice: automatic conflict detection in evidence scoring (see docs/EVIDENCE_STRENGTH.md); a retry sweep for resolutions whose semantic indexing failed; public SCADA event import; HNSW indexing, which the corpus is far too small to justify.

## Superseded checkpoint — foundation phase

| Command/check | Actual result |
| --- | --- |
| npm install --ignore-scripts | Success; npm workspaces resolved and lockfile written |
| npm run typecheck | Passed across shared, backend, frontend, scripts and tests |
| npm run lint | Passed |
| npm run test | Passed64 tests,3 files:20 RAG helpers,37 real-loopback HTTP,7 ingestion trust-boundary |
| npm run build | Passed all3 workspaces; frontend Vite6.4.3 production bundle and backend emitted |
| npm run dev | Both services started; frontend5173, backend3001 |
| HTTP smoke | GET frontend/, proxied/api/health and direct/api/health all200; honest degraded/no-DB status |
| npm run rag:ingest -- --file data/knowledge/synthetic-note.example.json --dry-run | Passed local manifest validation; no embeddings or DB writes |
| npm run db:seed -- --dry-run | Passed file reading; sqlExecuted:false |
| npm audit | Zero reported vulnerabilities after dependency updates; this is not proof of all security properties |
| SQL static review |12 tables/provenance/RLS/dimension/FK/transaction framing checked; live behavior unverified |

Known limitations: no configured DATABASE_URL/OpenAI key, no applied migration, no acquired public reference corpus, no complete hybrid retrieval/synthesis, no semantic resolution indexing, no public hosting/authentication, and no browser-based visual interaction QA. Node/network sandbox sessions are transient; delivered dev commands are for the user's VS Code environment. Existing local HTTP tests use real servers and no external services. The first-phase gate is complete; live product acceptance remains open.

## Latest checkpoint — 2026-09-10, completion phase

This session had **no network access from the build environment**: the npm registry returned 403, so `npm ci` could not run and no dependency was installable. That constrains what can honestly be claimed below.

| Command / check | Actual result |
| --- | --- |
| `npm ci` | **Not run.** Registry unreachable (HTTP 403). No `node_modules` was installed. |
| `npm run lint` | **Not run** — requires eslint from the registry. |
| `npm run typecheck` | **Not run** — requires the workspace type dependencies. New code was written against the existing strict settings but is **not compiler-verified**. |
| `npm run test` | **Not run as `vitest`.** See the row below for what was actually executed. |
| `npm run build` | **Not run.** |
| Offline execution of the real test files | **69 tests passed, 0 failed.** Executed with Node 22.22 and tsx against the project's actual `.test.ts` files, using a local stand-in for the vitest `describe/it/expect` API. Files: `backend/src/rag.test.ts` (20), `tests/integration/retrieval.test.ts` (17), `tests/integration/investigation.test.ts` (25), `tests/integration/penmanshiel.test.ts` (7). |
| `tests/integration/http.test.ts` | **Not executed** — needs express, zod and helmet. Two assertions were updated for the new behaviour (`phase: 'mvp'`, and 503 `DATABASE_NOT_CONFIGURED` in place of `INVESTIGATION_NOT_IMPLEMENTED`). |
| `tests/integration/ingestion.test.ts` | **Not executed** — needs zod. Extended with cases covering the three new public manifests. |
| Public file acquisition | **Verified.** `Penmanshiel_WT_static.csv` downloaded and its MD5 matched Zenodo's published checksum byte for byte. |
| Knowledge manifest validation | Structurally validated against the frozen ingestion schema by an independent check: key sets, enum members, provenance rules, chunk counts and size ceilings all pass. Not yet validated by Zod itself. |
| Live database | **Never reached.** No migration, seed, import or query has run against PostgreSQL. |
| Live OpenAI | **Never called.** No embedding and no synthesis request was made. `gpt-5.6-terra` and `text-embedding-3-small` remain configuration contracts, not verified access. |
| Browser QA | **Not performed.** The workspace has not been rendered in a browser. |

Read the offline test row precisely: it is real execution of the real test files, and it genuinely exercises retrieval scope, safety refusal, citation repair, strength capping and degraded-synthesis behaviour. It is not a substitute for `npm run test`, and it cannot catch a TypeScript compile error or a malformed SQL string.
