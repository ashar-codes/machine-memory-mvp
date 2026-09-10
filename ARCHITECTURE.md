

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
only reviewed public reference text lives in pgvector. That separation is what lets a count be a
count rather than a model's estimate.
