# Project context and verified checkpoints

Current branch: `fix/predeployment-audit`. This is an integrated remediation checkout;
no parallel owner is active. Shared v1 types/schema remain unchanged. Current files are
authoritative; the archived audit describes the older baseline, not today's implementation.

| Gate / section | Latest established evidence (2026-09-11) |
| --- | --- |
| Offline tests / typecheck / lint / build | PASS: 377 tests; all three compile/lint/build gates passed after F |
| A safety and grounding | Completed; deterministic exact facts, conservative generated-text checks; not universal entailment/safety validation |
| B intent, context, dates | Completed; historical live SQL and browser regressions recorded in ledger; not rerun this continuation |
| C PDF, CSV, embeddings | Completed; historical real PDF/provider/DB and concurrent CSV checks in ledger |
| D1 relevance | `7625bbd`; live Gemini/Postgres paraphrases and no-evidence question PASS; 251-candidate SQL test PASS |
| D2 replay integrity | `8bd2b64`; HTTP/SSE tests and live PostgreSQL conflicting replay PASS |
| D3 detached failures | `3819d44`; injected acquisition/query/provider failures PASS; no live outage induced |
| E local resource bounds | `70651b8`; paused-provider HTTP saturation/disconnect/recovery, upload pool occupancy and SSE tests PASS |
| F current documentation | Restored setup/architecture/API index and checkpoint table; corrected preview, embedding and authority claims |
| D4 reset coordination | DEFERRED: no safe online-reset or derived-status restoration claim |
| Authentication / Internet deployment | DEFERRED; loopback and production refusal retained |
| Fresh migrations / restart recovery / production load | Not established by this continuation |

[Remediation status](docs/REMEDIATION_STATUS.md) records commands, scope, limitations and the
next work. This continuation made no persistent live-data or schema changes: relevance fixture
and replay transactions rolled back. Provider probes used real embeddings, no generation.

## Real public data — 2026-09-10

Genuine Penmanshiel operational events are now imported: 1,172 rows for two turbines, February 2023,
from Zenodo record 16807304 (CC-BY-4.0). Verified live — the copilot summarizes real event history,
counts real recurrences in SQL, and combines real operational facts with public OSHA/NREL reference
evidence in a single answer with the two clearly separated by provenance.

Two accuracy defects surfaced from working with real data rather than synthetic: the deterministic
answer conflated "no resolution recorded" with "no records at all", and intent classification let a
passing mention of "maintenance" outrank an explicit request for technical references.

SCADA signal rows and event history beyond PEN-T01/PEN-T02 remain outside the imported
subset. Fourteen turbine identities are present; only two have imported event history.
