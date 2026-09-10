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
| B / P2-01 | NOT_STARTED | Generic HISTORY precedes specific change intent; fixed window. |
| B / P2-02 | NOT_STARTED | No stale-request/context identity protection. |
| B / P2-06 | NOT_STARTED | UTC text interpreted as local datetime; regex calendar validation. |
| C / P2-03 | NOT_STARTED | pdf-parse v1 call against installed v2. |
| C / P2-04 | NOT_STARTED | Optional CSV description inserted as null into NOT NULL field. |
| C / P2-05 | NOT_STARTED | Concurrent preview commits have no atomic DB claim. |
| C / P2-08 | NOT_STARTED | Runtime documents use query task; model-space compatibility unenforced. |
| D / P2-07 | NOT_STARTED | Candidate cap before relevance; authority creates admission. |
| D / P2-09 | NOT_STARTED | Replay payload combines stored ID with incoming fields. |
| D / P2-11 | NOT_STARTED | Detached pool acquisition outside catch. |
| D / P2-10 | NOT_STARTED | Parent not rechecked after embedding; reset leaves derived status. Only fix if small/safe. |
| E / P1-04 | NOT_STARTED | No global bounded expensive-job admission / slow-consumer handling. |
| F / false claims | NOT_STARTED | Correct only demonstrated overclaims outside archived audit. |
| P1-01 | DEFERRED | Explicitly out of scope: keep production, loopback and Host/Origin safeguards. |

## Checkpoints / verification

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

Phase A is complete. **Next exact finding: B1 / P2-01** (recent-change intent/window).
Start with `backend/src/copilot.ts` (`classifyIntent`), `backend/src/retrieval.ts`
(`RECENT_CHANGE_WINDOW_DAYS`, `retrieveEvidence`, `recentChanges`) and
`tests/integration/{retrieval,dynamic}.test.ts`, `tests/integration/fakeDatabase.ts`.
Reproduce "What changed recently before this event?" selecting HISTORY before editing.
Use the September 7 inspection and explicit 7/30/90-day windows; do not silently use 30 days
for an unsupported requested window. Do not claim the intent fix already follows from A2.
Then continue B2/P2-02 → B3/P2-06 → C → D → E → F in ledger order.
Run lint/typecheck/relevant tests/diff check for each coherent checkpoint; full gates before final.
Do not open Internet access or claim local readiness until outstanding correctness gates pass.

### Handoff state

- Completed: P1-02, P1-03; archived audit unchanged. Latest code checkpoint `fcda34a`.
- Remaining: every B/C/D/E/F ledger item; P1-01 intentionally DEFERRED.
- No migrations added or applied; no live data created/deleted/updated during Phase A.
- Last full gates: 13 files / 326 tests, lint/typecheck/build/diff check PASS; npm audit zero.
- Remaining known defects are described by the immutable audit and NOT_STARTED ledger rows.
- Local full hackathon demo: NOT READY. Internet: KEEP BLOCKED.
- Verification commands: `node --import tsx scripts/verify/safety.ts` (requires loopback app;
  seven requests count against existing rate limit), `node --import tsx scripts/verify/grounding.ts`
  (configured PostgreSQL; BEGIN READ ONLY; injected provider, no paid calls).
