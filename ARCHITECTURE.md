# Current architecture

React/Vite renders the investigation workspace and sends same-origin API requests through
its loopback proxy. Express validates inputs; PostgreSQL stores structured history and
provenance, with pgvector for reference and memory text. Shared wire types are in
`packages/shared/src/index.ts`; backend route schemas validate runtime inputs.

The investigation pipeline classifies intent, computes exact counts/windows in parameterized
SQL, retrieves metadata-compatible reference candidates, then deduplicates/ranks/caps evidence.
Reference admission uses keyword or calibrated semantic relevance before LIMIT 200. Authority
and record origin are separate from similarity and cannot authorize equipment operations.
Gemini query/document embedding roles are explicit; model, dimension and format provenance
must match before cosine comparison. Keyword search remains available without embeddings.

Summaries and exact operational facts are deterministic. Optional Gemini/Groq generation is
parsed and conservatively constrained to retrieved evidence; invalid results fall back to
structured answers. Citation membership is not proof of entailment. Safety rules are finite
English matching and fail closed for recognized unsupported procedures/limits; they do not
make the system an operational safety authority.

`recordEvent` handles Scenario Lab and simulator/adapter events. CSV import, seed and the
public importer use separate parameterized batch paths. Preview stores source metadata;
confirmed CSV commit atomically claims that source before storing operational rows.
Uploads and resolutions keep their user origin and UNVERIFIED authority when embedded.
A saved resolution is immediately SQL-retrievable; semantic indexing is best effort, with
no durable retry queue. Embedding waits hold no transaction client.

Two expensive jobs share a local admission gate, including detached analysis/indexing;
no work queue exists. Model operations share a lifetime allowance. These controls are
local mitigations, not authentication, distributed admission or a provider billing limit.
SSE bounds client count and frame size and disconnects on backpressure.

Reset is still an offline operator path without coordinated writer quiescence or guaranteed
derived-status restoration. See P2-10 in `docs/REMEDIATION_STATUS.md`. No model-generated SQL,
code execution, equipment-control route, frontend secret or production startup is supported.

## Public operational data (v2.3)

```
Zenodo archive ─▶ Status_*.csv (raw, byte-preserved) ─▶ parser ─▶ derived CSV
                                                              └─▶ batched insert ─▶ asset_events
```

Real Penmanshiel events reuse the existing pipeline entirely: the same `asset_events` table, the
same retrieval, the same copilot. The only new code is a parser and an import stage.

Idempotency reuses the `(event_source, external_event_id)` index the operational-event boundary
already added, so no migration was needed. The external id is deterministic —
`<sourceTurbine>:<startedAt>:<sourceCode>`.

Operational rows are **not embedded**. Recurrence and period questions are SQL over structured rows;
reviewed public references, uploaded documents and saved-resolution narratives can live in pgvector. That separation is what lets a count be a
count rather than a model's estimate.
