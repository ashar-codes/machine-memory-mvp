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
| D / P2-09 | NOT_STARTED | Replay payload combines stored ID with incoming fields. |
| D / P2-11 | NOT_STARTED | Detached pool acquisition outside catch. |
| D / P2-10 | NOT_STARTED | Parent not rechecked after embedding; reset leaves derived status. Only fix if small/safe. |
| E / P1-04 | NOT_STARTED | No global bounded expensive-job admission / slow-consumer handling. |
| F / false claims | NOT_STARTED | Correct only demonstrated overclaims outside archived audit. |
| P1-01 | DEFERRED | Explicitly out of scope: keep production, loopback and Host/Origin safeguards. |

## Checkpoints / verification

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

No migrations added/applied, no live DB writes.
Unit tests must not call paid providers. Live verification must be separate and preserve
public_data, public_reference and synthetic_demo. Do not run broad reset over user data.

## Continuation

Phases A–C and D1/P2-07 are complete. Next: D2/P2-09 (conflicting SCADA replay),
then P2-11 detached indexing failure, P2-10 reset coordination if small/safe,
E/P1-04 resource admission, and F demonstrated documentation overclaims.
Use the ledger and checkpoint entries above; older checkpoints describe historical gates.
Keep the archived audit unchanged and commit each verified section.
Local full demo readiness remains unestablished until remaining gates pass.
Internet exposure remains blocked; P1-01 is deliberately deferred.
