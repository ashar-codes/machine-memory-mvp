# Predeployment remediation status

Historical audit: `docs/audits/codex-predeployment-audit-2026-09-11.md`, describing
`197ff7248dbefc87a6ca254e15d55682115bb349`. Do not modify that report.
Archive commit: `6a49352`; SHA256 `25f3406f1f18a9244577e576cdc1e63dc3a4d3d24014873922da246f58f74378`.
Branch: `fix/predeployment-audit`. No later feature commits existed at start.

## Baseline

2026-09-11: lint PASS; typecheck PASS; tests PASS (11 files / 280 tests,
610 ms); build PASS (40 Vite modules); `git diff --check` PASS.
Archive inspection: byte-identical to original external report, UTF-8 text,
no secret-pattern/known configured credential values or embedded binary artifacts.
Archive-only commit left a clean tree before creating remediation branch.

## Finding ledger

| Phase / finding | Status | Root cause / next work |
|---|---|---|
| A / P1-02 | VERIFIED | Generic reference authority was confused with operational authorization. Operational requests now fail closed; expanded action families refuse before DB/provider calls. |
| A / P1-03 | VERIFIED | ID membership previously admitted invented facts. Summaries/exact facts now deterministic; typed recorded outcomes copied from retrieval; generated evidence-context text conservatively constrained. |
| B / P2-01 | VERIFIED | Specific change intent precedes HISTORY; explicit 7/30/90-day windows honored, unsupported duration requests clarified without provider calls. |
| B / P2-02 | VERIFIED | Abort controllers invalidate old results; keyed asset Copilot resets turns; scope/workspace switches and empty responses clear evidence. |
| B / P2-06 | VERIFIED | Local components format datetime defaults; preserved default instant across DST fold; real calendar validation rejects impossible dates. |
| C / P2-03 | VERIFIED | Uses installed PDFParse v2 getText and finally destroy; textless PDFs rejected without indexing synthetic page labels. |
| C / P2-04 | VERIFIED | Missing event CSV description normalizes to empty text, matching recordEvent; required-only imports pass actual PostgreSQL constraints. |
| C / P2-05 | VERIFIED | Transactional data-source UPDATE claims preview atomically; competing commit and response-loss retry return 409 without duplicate rows. |
| C / P2-08 | VERIFIED | Explicit document embedding role propagates through Gemini-only wrapper; fixed model/dimensions enforced; incompatible chunk metadata gets no cosine comparison. |
| D / P2-07 | VERIFIED | Relevance admission and ordering precede candidate cap; authority remains provenance, not topical relevance. |
| D / P2-09 | VERIFIED | HTTP/SSE use persisted payload; duplicate snapshots omitted; provenance conflicts return 409. |
| D / P2-11 | VERIFIED | Entire detached indexing promise is caught, including acquisition and release. |
| D / P2-10 | DEFERRED | Active reset needs writer quiescence, parent/index ordering and derived-status restoration; not a safe isolated patch. Stop app and all writers before reset; status restoration remains unresolved. |
| E / P1-04 | LOCAL_CONTROLS_VERIFIED | Two active jobs, no queue, lifetime model-operation allowance, lazy DB acquisition, bounded SSE writes. Per-user/distributed billing controls remain deferred with authentication. |
| F / false claims | VERIFIED | Current runbook/checkpoints restored; preview, embedding, write-path and assurance statements corrected. |
| P1-01 | DEFERRED | Explicitly out of scope: keep production, loopback and Host/Origin safeguards. |

## Checkpoints / verification

### F — current documentation and demonstrated claims

- Restored README local setup and boundaries, PROJECT_CONTEXT checkpoint table, architecture
  description and API route index. Shared v1 types/schema remain unchanged. Database/seed
  foundation notes now explicitly point to later live evidence instead of posing as current gates.
- Data Hub now states that preview writes source metadata, while confirmed operational rows
  retain user_import or simulation origin. Documented runtime uploads/resolution embeddings,
  separate CSV/seed event paths and limits of citation/English safety checks. Removed the
  categorical claim that provenance badges prevent all confusion.
- Replay review kept asset_code as internal duplicate lookup metadata rather than adding it
  to the manual-event creation response. SCADA uses the validated new-event asset identity
  and persisted duplicate identity; live replay verification rerun after this adjustment.
- Gates: 377 tests, lint/typecheck/build/diff check PASS. No browser rerun for copy-only UI
  correction. Archived audit SHA256 unchanged; no dependencies, migrations or persistent
  live writes. E checkpoint: `70651b8`.

### E — local resource controls

- One shared application gate admits at most two investigation/Copilot/upload/preview/save
  or background-index/automatic-analysis jobs. No pending queue. Excess HTTP work returns
  503 WORK_CAPACITY_REACHED before multipart parsing; background work skips without undoing
  stored events/resolutions. Slots follow actual completion, not response/disconnect events.
- Shared lifetime allowance: 500 logical model operations (embedding, synthesis, structured),
  counting failures. After exhaustion existing deterministic/keyword fallback applies.
  This is not a dollar budget: provider retries/failover occur within an operation; restart
  replenishes the allowance. Per-user, multi-process and provider-side billing limits remain
  outside the unauthenticated local demo boundary.
- Upload and resolution indexing acquire their dedicated transaction client at first SQL,
  after embeddings. SSE disconnects on write backpressure/throw, including heartbeat and
  initial frame; individual frames over 64 KiB are omitted. Eight-client cap retained.
- Seven added tests PASS, including real loopback saturation/abort/recovery, upload connection
  occupancy with paused embedding, allowance exhaustion and slow-stream handling. Indexing
  failure regression now asserts zero clients acquired on embedding failure.
- Gates: 377 tests, lint/typecheck/build/diff check PASS. No live load attack, paid calls,
  database writes, migration, dependency change or Internet exposure for this section.
- D3 checkpoint: `3819d44`. P2-10 explicitly deferred under its small/safe scope: an online
  reset cannot be made coherent by a parent check alone; CLI and all writers need coordination.

### D3 — contain detached indexing failures

- Reproduced unhandled connection-acquisition rejection after a successful structured save.
  The detached promise now has an outer catch covering acquisition, indexing and release.
  Error output remains fixed/sanitized; only acquired clients are released.
- Four injected HTTP regressions PASS: connection rejection, query failure, provider timeout
  rejection and closed-pool-style acquisition rejection. Structured COMMIT and 201/pending
  response remain intact, with no rollback or unhandled rejection.
- These are injected failures, not a live DB outage or process shutdown test. No provider
  calls or live writes. Gates: 370 tests, lint/typecheck/build/diff check PASS.
- D2 checkpoint: `8bd2b64`.

### D2 — persisted SCADA replay payload

- Reproduced changed asset/code/title/severity/description contaminating the stored event ID.
  Responses and stream payloads now use returned database fields and stored asset identity.
  Duplicate signals are empty because snapshots are not persisted; duplicate events do not
  trigger analysis. Conflicting non-simulation origin returns 409 EVENT_IDENTITY_CONFLICT.
- Two HTTP/router + stream regressions PASS. Live PostgreSQL conflicting replay PASS:
  original WT-07 event returned despite PEN-T01/new payload replay; exactly one event row.
  `scripts/verify/replay.ts` rolls back both event and derived-status changes.
- Existing unique-index concurrency mechanism unchanged; concurrent HTTP replay was not
  separately rerun. No schema/shared type change.
- Gates: 366 tests, lint/typecheck/build/diff check PASS. D1 checkpoint: `7625bbd`.

### D1 — relevance before authority and candidate cap

- Resumed the uncommitted retrieval/fusion changes from C4. SQL now admits semantic
  similarity >= 0.60 or keyword rank >= 0.01, and sorts relevant candidates before LIMIT 200.
  Reference authority is a small ranking tie-break; it does not admit unrelated content.
  General questions without machine context no longer substitute selected-asset history.
- Live Gemini + PostgreSQL PASS: five technical/safety questions including paraphrases
  ranked the expected NREL/OSHA source first; unrelated sourdough question admitted zero
  evidence in TECHNICAL_GUIDANCE and GENERAL (INSUFFICIENT, no synthesis call).
- Live PostgreSQL candidate regression PASS: relevant chunk at index 250 survives 251
  candidates, unrelated text excluded, low-authority upload remains non-procedural.
  All candidate fixtures rolled back; relevance probes make no persistent writes.
- Scripts: `scripts/verify/{relevance,relevance-candidates}.ts`. PDF verification now checks
  uploaded-document keyword retrieval and reports its failure stage; HTTP PDF check was
  not rerun for this checkpoint. Previous C4 PDF gate is historical evidence only.
- Limits: threshold calibrated for this demo corpus, not universal relevance; English
  machine-context matching is finite. Query scans/ranks filtered chunks; no large-corpus
  performance or approximate-vector-index claim. API/schema/provenance unchanged.
- Gates: 364 tests, lint/typecheck/build/diff check PASS.
- C4 checkpoint: `d66578e`. D1 checkpoint: this commit.

### C4 — embedding roles/model compatibility

- Reproduced all three initial regressions: document task sent as query, runtime indexing
  omitted role, and different same-dimension model accepted.
- Files: `backend/src/{config,llm,provider,knowledge,memoryIndex,retrieval}.ts`, updated Gemini
  configuration test, new `tests/integration/remediation-embedding.test.ts`,
  `scripts/verify/embedding-space.ts`.
- Explicit `embed(text, 'RETRIEVAL_DOCUMENT')` for uploads/memory; search defaults to
  RETRIEVAL_QUERY. Gemini wrapper retains role even when generation mode is Groq. Four payload,
  normalization, indexing and model-contract regressions; no quota in unit tests.
- Configuration now rejects incompatible embedding-model overrides, rather than pretending
  equal dimensions imply equal space. Corpus remains gemini-embedding-001 / 1536, untouched.
- Live pgvector PASS: 21 public chunks compatible; temporary wrong-model/dimension/format-version
  chunks never get cosine similarity, remain keyword evidence. All fixture inserts rolled back.
- Real PDF upload reverified after task correction: one actual embedding, UNVERIFIED provenance;
  existing safe reset cleanup, protected fingerprints unchanged.
- Gates: lint/typecheck/build/diff check PASS; **362 tests PASS**.
- C3 checkpoint: `ad1fecd`. C4 checkpoint: this commit (`fix: distinguish embedding roles and enforce corpus compatibility`).

### C3 — concurrent CSV commit

- Reproduced over real HTTP/PostgreSQL: same preview committed concurrently returned
  `[201,201]` and stored two events. Fixed by conditional source-row UPDATE inside the same
  transaction as batch/record inserts; PostgreSQL serializes/rechecks the claim across clients.
  Rollback restores source availability. No migration or process-local mutex required.
- Files: `backend/src/routes.ts`, `scripts/verify/import-concurrency.ts`.
- Live regression PASS: `[201,409]`, exactly one event and batch; repeat after successful
  commit returns 409 `IMPORT_ALREADY_COMMITTED`. Preview with no description also commits
  through real API and stores empty text. This is not cross-server preview storage: another
  process without the preview still cannot import it, but cannot duplicate an existing commit.
- Existing safe reset removed uniquely named test asset/site/source/history; 13 protected-table
  fingerprints unchanged after reproduction and fixed verification. No public data modified.
- Gates: lint/typecheck/build/diff check PASS; **358 tests PASS** plus live regression script.
- C2 checkpoint: `06ef03d`. C3 checkpoint: this commit (`fix: claim CSV previews atomically in PostgreSQL`).

### C2 — optional CSV description

- Reproduced null description via strengthened existing test and actual PostgreSQL NOT NULL
  rejection. Minimal root fix: normalize absent event description to empty string.
- Files: `backend/src/imports.ts`, `tests/integration/dynamic.test.ts`,
  `scripts/verify/import-optional.ts`. Other optional import fields checked against schema:
  maintenance supplies description fallback; work-order nullable fields and note timestamp
  default already agree with persistence.
- Live PostgreSQL PASS: all four import types with required-only CSVs, mapping validation,
  actual inserts and empty-description/null optional-field assertions. Single transaction
  rolled back, no asset status updates or persistent records. No migrations.
- Gates: lint/typecheck/build/diff check PASS; **358 tests PASS** (existing test strengthened).
- C1 checkpoint: `bf38c69`. C2 checkpoint: this commit (`fix: normalize absent CSV event descriptions`).

### C1 — real PDF ingestion

- Reproduced valid PDF rejection against real installed library before correction.
- Files: `backend/src/routes.ts`, `tests/integration/{pdfFixture,remediation-pdf.test}.ts`,
  `scripts/verify/pdf.ts`. Fixture is text source producing a real byte-correct PDF, not a
  mocked parser or committed binary. Four real-library/upload-boundary tests added.
- Live HTTP + Gemini + PostgreSQL PASS: valid PDF created one chunk with one real embedding;
  source remained user_import / UNVERIFIED. Fake, corrupt and textless PDFs returned 400.
  Textless message explicitly says OCR unsupported. PDF worker cleanup runs in finally.
- `node --import tsx scripts/verify/pdf.ts` requires an idle demo with no user data and refuses
  reset when other user records appear. Existing `demo-reset --include-imports` cleaned test
  records; all 13 protected-table fingerprints unchanged. No migrations applied.
- Gates: lint/typecheck/build/diff check PASS; **358 tests PASS**.
- B3 checkpoint: `bf9585d`. C1 checkpoint: this commit (`fix: use PDFParse v2 for real text ingestion`).

### B3 — timezone/calendar correctness

- Reproduced Asia/Karachi five-hour shift in Chrome, and impossible commissioning dates
  reaching database handling instead of HTTP 400.
- Files: `frontend/src/{scenario.tsx,localTime.ts}`, `backend/src/routes.ts`, new
  `tests/integration/remediation-time.test.ts`, HTTP tests, extended browser verification.
- 13 additional unit/HTTP regressions: UTC, Karachi, negative offset, DST timezone,
  invalid calendars, leap day, DST gap rejection and untouched default during repeated hour.
- Browser PASS: actual intercepted default POST within one minute of now; manual Karachi
  `2024-02-29T12:00` submits `2024-02-29T07:00:00.000Z`. No database writes/provider calls.
  Manually entered ambiguous DST times use first occurrence, explicitly stated in UI.
- Gates: lint/typecheck/build/diff check PASS; **354 tests PASS** plus browser checks.
- B2 checkpoint: `6996237`. B3 checkpoint: this commit (`fix: preserve local scenario instants and validate calendar dates`).

### B2 — cross-context response race

- Reproduced in real Chrome: delayed WT-07 response displayed after PEN-T01 selection.
- Files: `frontend/src/{App,copilot}.tsx`, `scripts/verify/context-race.mjs`.
- Requests check their abort signal after response/error, even if transport ignores cancellation.
  Asset selection resets details and remounts Copilot; scope changes clear turns and evidence;
  synchronous admission prevents double Copilot turns; empty answers clear previous evidence.
- Browser regressions PASS: asset investigation race, Copilot asset switch, asset→fleet,
  fleet→asset, memory→Copilot, rapid double activation, fresh then empty evidence, no history
  carried into new context. Injected delayed provider responses deliberately ignore AbortSignal.
- Run: local dev stack + Chrome debug port 9234, `node scripts/verify/context-race.mjs`.
  Real API reads only; no paid calls/data writes. No dependency added.
- Gates: lint/typecheck/build/diff check PASS; full suite **341 tests PASS** plus browser checks.
- B1 checkpoint: `22b62a4`. B2 checkpoint: this commit (`fix: isolate asynchronous answers by workspace context`).

### B1 — recent-change intent and windows

- Reproduced three misclassified questions and ignored 7/90-day windows. Also corrected a
  fake-database matcher that intercepted the change UNION as a work-order query, letting
  the old empty-result window assertion pass vacuously.
- Files: `backend/src/{copilot,retrieval,investigate}.ts`, `tests/integration/fakeDatabase.ts`,
  new `tests/integration/remediation-recent.test.ts`, `scripts/verify/recent.ts`.
- 15 new regressions: intent, actual fixture rows/order, exact spans, unsupported/ambiguous
  durations and zero provider calls on clarification. Default remains 30 days, ending at
  selected event (now if no event); explicit supported syntax is numeric day windows.
- Live: six real PostgreSQL retrieval + deterministic synthesis cases PASS, newest inspection
  `2026-09-07T09:00:00.000Z`; citations resolve. Read-only transaction, no provider calls or writes.
  `node --import tsx scripts/verify/recent.ts`.
- Protected baseline captured at `/private/tmp/mm-remediation.Km3hfl/database-before.jsonl`.
- Gates: lint/typecheck/build/diff check PASS; full suite 14 files / **341 tests PASS**.
- Checkpoint: this B1 commit (`fix: honor recent-change intent and supported windows`).

### A1 — safety / operational authorization

- Files: `backend/src/{rag,investigate,copilot}.ts`, `tests/integration/investigation.test.ts`,
  new `tests/integration/remediation-safety.test.ts`, `scripts/verify/safety.ts`.
- Reproduced before fix: 23 of 25 initial regression cases failed, including generic-authority
  thresholds and safety requests blocked by a failed DB connection.
- Tests added: 26 cases (defeat families, buried/manager requests, generic OSHA/NREL,
  user imports/synthetic history, operational limits, descriptive history allowed).
- Intentional contract behavior: refused requests no longer retrieve reference citations;
  they return an empty evidence set without DB, embedding or generation work.
- No approved asset-specific procedure corpus/authorization contract exists. Generic reviewed
  material cannot authorize operations. Finite English matching is NOT universal semantic safety.
- Live: `node --import tsx scripts/verify/safety.ts` passed 7 real loopback HTTP probes,
  including asset/fleet Copilot. No database writes or paid generation required.
- Gates: lint/typecheck/build/diff check PASS; full suite **12 files / 306 tests PASS**.
- Checkpoint: `7216363` — `fix: fail closed for unsupported operational guidance`.

### A2 — exact-claim grounding

- Files: `backend/src/{synthesis,investigate,copilot,retrieval}.ts`, updated failover/SCADA
  expected-answer assertions; new `tests/integration/remediation-grounding.test.ts` and
  `scripts/verify/grounding.ts`.
- Reproduced before fix: all 16 initial cases failed, including real citation + invented
  count/date/pressure/asset/cause, summary-only attack and Fleet answer bypass.
- Tests added: 20 cases. Existing provider selection and citation checks preserved.
- Exact counts/dates and summaries are rendered from retrieved facts, not generation.
  Stored outcome/component/downtime fields are typed separately from free-text notes.
  Qualitative generation has a conservative evidence-context vocabulary; unsupported domain
  terms, numbers, identities and permission claims are discarded. This is deliberately lossy,
  NOT general natural-language entailment validation. Do not casually widen this boundary.
- Live: read-only PostgreSQL + injected hostile provider passed 5 wrong-valid-ID cases,
  exact WT-07 total 3 / prior 2, stored resolution and downtime checks. All 13 protected-table
  fingerprints unchanged; all 14 public tables RLS enabled; no public/anon/authenticated grants
  or public policies. No schema/data mutation. `node --import tsx scripts/verify/grounding.ts`.
- Live HTTP: real Groq fallback returned WT-07 SQL counts and recorded outcomes with resolved
  citations. Gemini generation success is still not established (quota failure, fallback retained).
- Gates: lint/typecheck/build/diff check PASS; full suite **13 files / 326 tests PASS**.
  `npm audit --json`: zero vulnerabilities. `.env` ignored/untracked; secret-pattern scan found
  only existing dummy DB-URI test fixture and literal frontend setup label DATABASE_URL.
- Live metadata secret scan: 44 metadata rows checked, no configured credential values or
  recognizable provider/private-key secrets found; values were not logged.
- Checkpoint: `fcda34a` — `fix: constrain generated operational facts`.

No migrations added/applied during remediation. Live fixture writes and their cleanup/rollback
are recorded in individual checkpoints above. Unit tests must not call paid providers. Live verification must be separate and preserve
public_data, public_reference and synthetic_demo. Do not run broad reset over user data.

## RAG acceptance remediation (independent Codex RAG test)

Eight reproduced defects, each fixed at its cause rather than in prompt wording, with a
regression test that fails without the fix. Checkpoints: `a092cf5`, `93a5666`, `a843fba`,
`7aae245`, `efd5fd9`, `439ef7f`, `8b484a8`.

- **Intent routing** — a flat first-match keyword chain let any incidental word decide the
  intent; "maintenance" alone sent a research question into the machine's change window.
  Replaced by `backend/src/routing.ts`, which decides on the shape of the request: whether it
  names a code, speaks about this machine, asks for a count, or asks about the whole turbine.
  Deterministic and provider-free. 49 paraphrase-based cases in
  `tests/integration/routing.test.ts`.
- **Named event codes** — a code named in the question now outranks the event selected in the
  interface. Two different codes in one question produce a clarification rather than a silent
  choice. Extraction requires a digit, so "lockout-tagout" is not read as a code.
- **Asset-wide scope** — an asset-wide question is answered from the asset's own SQL totals
  instead of being narrowed to the selected code. `QueryScope` carries that decision from
  routing into retrieval.
- **Dynamically uploaded knowledge** — a retrieved but unreviewed document is now quoted and
  cited behind an explicit unverified label, instead of being retrieved and then omitted.
- **Evidence identity** — the deduplication key excluded the retrieval role, so one work order
  reached through two roles survived as two items and an answer reported four maintenance
  records where the database held two. Records are keyed on their database identity.
- **Aggregate facts** — an exact total is proved by a computed aggregate admitted to the
  evidence set ahead of the rows it summarises. Ranked as an ordinary candidate it scored below
  those rows and was evicted by the candidate cap, leaving an exact figure with nothing citable
  behind it.
- **Evidence strength** — scoring is intent-aware. It answers "how strongly does the retrieved
  evidence support this question", not "how much authoritative material is in the bundle".
  Unrelated machine history can no longer raise a research question, and unrelated references
  can no longer raise a machine question. Matrix in `tests/integration/strength.test.ts`.
- **Latency** — stage timings (routing, embedding, retrieval, generation, total) travel in
  `structuredFacts`. Retrieval's independent queries now overlap instead of running one at a
  time; the pool was widened to match that fan-out; a provider that failed on quota, rate limit
  or authorization is skipped for ten minutes instead of being re-probed per request; startup
  warms database connections and the embedding client.

Two defects were found while verifying, not reported by the test, and are fixed:

- Overlapping the retrieval queries introduced an unhandled-rejection crash — a query started
  but never read, or still in flight when an earlier await threw, terminated the process. Every
  eagerly started query is now observed at creation. The regression test fails without the fix.
- A pool-acquisition timeout was reported as HTTP 500 "The request could not be completed",
  blaming the application for a slow database link. It is now a 503, and 5xx responses log their
  shape (status, error name, driver code — never a message, query or connection detail).

Acceptance: 18 live checks across routing, code precedence, scope, upload answering, reference
quoting, aggregate grounding, strength, safety refusal, asset isolation and fleet scope — all
passing, with every citation resolving and every number in a summary present in a cited excerpt.
Latency median 3.8s, p90 6.2s, max 9.9s, none over 15s. Protected fingerprints unchanged before
and after: 1177 asset events (1172 `public_data`, 5 `synthetic_demo`), 3 `public_reference`
documents, 21 chunks, 17 assets, 1 synthetic resolution, and zero `user_demo`/`user_import` rows
after the acceptance document was removed.

Both model providers' free-tier quotas were exhausted during this work, so the acceptance run
answered entirely on the deterministic path — which passed every grounding check. Live Groq
generation was observed earlier in the same session with resolving citations and no invented
identifiers. Gemini generation success remains unestablished on this key.

Not addressed, by scope: deployment, authentication, reverse proxies, production hosting, UI
redesign, framework/database/vector-store replacement, and additional model providers.

## Continuation

Completed: A–C, D1–D3, local E controls and F documentation. The remaining scoped exception
is P2-10 reset/writer coordination, deferred because the ledger only authorized a small/safe
fix. A future section must establish quiescence for all writers, lock/recheck parent records,
order deletes against indexing, and verify derived status on disposable fixtures. Do not
run online reset or infer safe reset from provenance filters alone.

P1-01 authentication remains deliberately deferred. Per-user/distributed billing controls,
fresh migration replay, full lifecycle recovery and deployment verification remain open.
Local full-demo readiness is not established; Internet exposure stays blocked. Keep the
archived audit unchanged and use this ledger and PROJECT_CONTEXT for the current handoff.
