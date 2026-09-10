# Machine Memory

**An asset-conditioned retrieval-augmented generation system for wind turbine maintenance intelligence.**

The turbine is the unit of memory. A technician selects an asset and asks what happened to *this machine*: has this fault happened before, how was it resolved, have other turbines seen it, what changed recently, and what published reference material applies. When a new resolution is logged it becomes part of that machine's retrievable memory immediately, with no model retraining.

This is decision support for a university demonstration. It reports what is recorded. It does not issue maintenance instructions, approve work, or authorize any deviation from protection systems.

## Run it on Windows (Git Bash)

Node 22.12 or newer. From the extracted `machine-memory-mvp` folder:

```bash
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:5173. With no credentials the app starts and says plainly that the database is not configured; nothing is faked. Backend health is at http://127.0.0.1:3001/api/health.

## Connect a database

1. Create a **dedicated** Supabase project. Do not reuse an unrelated production database.
2. Run `supabase/migrations/20260909202010_machine_memory.sql` once in the SQL editor. It owns its transaction. `docs/DATABASE.md` has the verification queries.
3. Put the session-pooler URI in `.env` as `DATABASE_URL`. Strip any `ssl*` query parameters: certificate verification is managed explicitly and the backend rejects URLs that try to override it. Percent-encode reserved characters in the password (`#` becomes `%23`), or both `new URL()` and dotenv's inline-comment stripping will mangle the URI. The Supabase pooler serves a private root, so set `DATABASE_CA_PATH=supabase/prod-ca-2021.crt` (the published Supabase Root 2021 CA, already in the repository).
4. Seed and import:

```bash
npm run db:seed                     # synthetic demonstration farm: WT-07, WT-03, WT-11
npm run data:penmanshiel -- --dry-run   # parse and checksum the real public file, no writes
npm run data:penmanshiel            # import 14 real Penmanshiel turbine identities as public_data
```

The Penmanshiel import adds a **separate site** with `PEN-` asset codes. It carries turbine identity and siting only — the published static file has no events — so those turbines have empty timelines. That is honest, not broken.

## Add the reference corpus

Create a Gemini API key in Google AI Studio and put it in `.env` as `GEMINI_API_KEY`, then:

```bash
npm run rag:ingest:corpus -- --dry-run   # validate all manifests, no embeddings, no writes
npm run rag:ingest:corpus                # embed and insert; uses Gemini free-tier embedding quota
```

This ingests three reviewed public references (3 documents, 21 chunks, verified present in the database): OSHA's wind-energy lockout/tagout page, hazardous-energy provisions of 29 CFR 1910.269, and NREL/TP-5000-80195 on drivetrain reliability. Each is stored as an attributed paraphrase with its source URL and authority class. Reruns are idempotent by content identity. The CLI only reads local reviewed JSON: it never fetches a URL, and the HTTP ingestion route is permanently disabled.

Without a key the application still works. Investigations retrieve structured evidence from SQL and answer deterministically from it; only semantic ranking and synthesis are unavailable, and the interface says so.

## Verify

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

`PROJECT_CONTEXT.md` records exactly which of these were executed at the last checkpoint and which were not. Do not assume a green tick that is not written there.

## How it answers

```
request → asset + event context → deterministic safety pre-check
        → intent-specific structured SQL (counts, timestamps, linkage, change window)
        → semantic + keyword knowledge retrieval over pgvector
        → evidence normalization → fusion and authority ranking
        → deterministic evidence strength → grounded synthesis
        → citation validation → InvestigateResponse
```

Two things make this more than "question → vector search → chatbot":

**Structured retrieval owns the facts.** Recurrence counts, timestamps, fleet matches and change windows are computed in parameterized SQL. The model is handed the numbers; it is never asked to count records, and it never sees or generates SQL.

**Authority is decided before ranking.** A synthetic demonstration note can score high on similarity and still cannot become technical guidance. Only reviewed public references are marked quotable as guidance. Evidence strength is `HIGH` / `MODERATE` / `INSUFFICIENT`, computed by the backend from what was retrieved — never a percentage, and never the model's opinion of itself.

## Safety behaviour

Requests to bypass, disable, defeat or override protection, to skip isolation, or to work on energized or faulted equipment return `safetyStatus: REFUSED` with no procedural content, whatever intent the caller claims. The check runs on the question text, so labelling a bypass request as `HISTORY` does not get past it.

Questions that would need a verified procedure or numeric limit return `INSUFFICIENT` unless authoritative reference material was actually retrieved. The system never invents torque values, pressure limits, setpoints, protection settings or lockout sequences.

## Repository map

| Path | Responsibility |
| --- | --- |
| `packages/shared/` | Frozen v1 wire types, intents, origins, evidence interfaces |
| `backend/src/retrieval.ts` | Intent-specific parameterized SQL and pgvector search |
| `backend/src/evidence.ts` | Deduplication, authority ranking, strength signals |
| `backend/src/synthesis.ts` | Evidence bundle, model instructions, strict parsing, deterministic fallback |
| `backend/src/investigate.ts` | Pipeline orchestration and safety gates |
| `backend/src/rag.ts` | Safety detection, evidence scoring, citation validation |
| `backend/src/llm.ts` | The only module that calls Gemini |
| `backend/src/routes.ts` | Asset/event creation, imports, knowledge upload, fleet queries |
| `backend/src/tabular.ts`, `mapping.ts`, `imports.ts` | CSV parsing, AI column mapping, transactional import |
| `backend/src/knowledge.ts` | Document chunking, embedding and the knowledge catalogue |
| `backend/src/copilot.ts`, `fleet.ts` | Asset and fleet copilot, predefined fleet queries |
| `frontend/src/` | Investigation workspace: asset rail, investigation panel, timeline, evidence panel |
| `supabase/` | 12-table schema with pgvector(1536), RLS, and the synthetic seed |
| `scripts/data/` | Seed and the Penmanshiel public importer |
| `scripts/rag/` | Reviewed local manifest ingestion |
| `data/knowledge/` | Reviewed public reference manifests |
| `data/raw/` | The verified public Penmanshiel static file |
| `tests/` | Retrieval, pipeline, ingestion, public-data and HTTP boundary tests |

## Reading order

`PROJECT_CONTEXT.md` for status, `ARCHITECTURE.md` for design, `docs/API_CONTRACT.md` for the wire contract, `SECURITY.md` before changing anything security-relevant, `DEMO_SCRIPT.md` to present it.

## Dynamic Machine Memory

Beyond the seeded demonstration, the application can learn a machine it has never seen.

| Section | What it does |
| --- | --- |
| **Fleet** | Live counts, recurring faults, recent machine memory |
| **Machine Memory** | The WT-07 investigation workspace |
| **AI Copilot** | Asset-scoped and fleet-scoped questions in plain language |
| **Data Hub** | Import event logs, maintenance, work orders and notes from CSV |
| **Knowledge Base** | Every indexed source, and upload of new technical documents |
| **Scenario Lab** | Onboard a turbine, inject a fault |

The short version of the flow: add a turbine, upload its event history as CSV, let Gemini propose
the column mapping, confirm it, and the turbine's recurrence is computable immediately. Upload a
technical document and it is chunked, embedded and citable on the next question — with no restart
and no retraining.

Two rules hold throughout, and they are what make this safe rather than merely impressive:

- **The model never writes SQL and never touches the database.** It suggests column mappings and
  picks from five predefined fleet queries; every suggestion is validated against a frozen
  allowlist before anything runs.
- **Anyone can add knowledge; nobody can add authority.** Uploaded documents are cited as evidence
  but are stored UNVERIFIED and can never license a procedure or a numeric limit.

`docs/DYNAMIC_INGESTION.md` has the field contracts, limits, provenance rules and security model.
