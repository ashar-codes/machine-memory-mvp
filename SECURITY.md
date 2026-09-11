

## Operational-event boundary (v2.2)

- **Read-only by construction.** No endpoint sends anything to industrial equipment. The normalized
  event schema is a strict object with no field capable of expressing a command, and the adapter
  interface has no write method. `SCADA → Machine Memory` exists; `Machine Memory → turbine
  control` does not, and must not.
- Ingestion validates with Zod: severity allowlist, identifier patterns and length limits on asset
  and event codes, ISO timestamps, a 12-entry cap on signal snapshots, a 16 KB body limit, and
  rejection of unexpected properties including prototype-pollution keys.
- Replays are idempotent through a database-enforced partial unique index, so a resending feed
  cannot inflate machine history or re-trigger an investigation.
- Every ingested event is stored `record_origin = 'simulation'` and badged as such throughout.
- Persistence is independent of AI availability: the event is committed before any investigation is
  attempted, so a provider outage costs an analysis, never a fault.
- The SSE feed is one-directional and bounded to 8 concurrent clients; no client message travels
  the other way. It inherits the existing loopback Host/Origin checks.
