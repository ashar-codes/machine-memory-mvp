

## Amendment 2.2 (2026-09-10) — operational-event boundary

Additive. Every route and shape above is unchanged.

| Route | Success body | Notes |
| --- | --- | --- |
| GET /api/scada/status | `ScadaStatus` | `simulated` is always `true`. Lists scenarios and recent simulator events. |
| GET /api/scada/stream | `text/event-stream` | SSE. Named events: `telemetry`, `event`, `run`. One-directional; bounded to 8 clients. |
| POST /api/scada/simulate | `StartSimulationResponse`, 202 | Starts a scenario run in the background. 409 `RUN_IN_PROGRESS` if one is active. |
| POST /api/scada/simulation/stop | `{status:'stopped'}` | Cancels an in-flight simulation run. Named for what it stops: no endpoint commands equipment. |
| POST /api/scada/ingest | `{event:ScadaEventPayload}` | 201 when created, **200 when the event is a replay**. The adapter-facing endpoint. |

`POST /api/scada/ingest` accepts a `NormalizedScadaEvent` and nothing else — a strict object with
no field capable of expressing a control command. Unexpected properties are rejected. Idempotency
is by `(source, externalEventId)`.

There is deliberately **no** route that writes toward industrial equipment.

New error codes: `SCENARIO_NOT_FOUND` 404, `RUN_IN_PROGRESS` 409.

`RecordOrigin` is unchanged; ingested events use the existing `simulation` member. `AssetEvent`
rows gain nullable `eventSource` and `externalEventId`; existing consumers are unaffected.
