# API contract — current route index

Existing shared v1 wire types remain authoritative in `packages/shared/src/index.ts`.
Runtime schemas are in `backend/src/{app,routes,scada}.ts`. This index describes the current
implementation; it does not introduce new request/response shapes.

All routes use the loopback/Host/Origin boundary. Errors use
`{error:{code,message,requestId}}`; model configuration in health is `configured_unverified`.
JSON POST bodies have an effective global 32 KiB limit except separately parsed SCADA routes.
Uploads are multipart and retain their existing per-file/field bounds.

| Route family | Behavior |
| --- | --- |
| GET /api/health | Dependency configuration and DB connectivity; no live model probe |
| GET /api/assets; GET /api/assets/:assetCode | Paginated assets; selected asset |
| GET /api/assets/:assetCode/current-event | Current event or null |
| GET /api/assets/:assetCode/incidents; /timeline | Paginated incident/history records |
| GET /api/assets/:assetCode/memory-status; /event-summary | Stored history counts and event summary |
| POST /api/investigate | InvestigateRequest → InvestigateResponse; omit `intent` for free text and the question is routed |
| POST /api/copilot | CopilotRequest → CopilotResponse, asset or fleet scope |
| POST /api/resolutions | 201 ResolutionResponse; structured saved, semantic pending |
| POST /api/assets; POST /api/events | 201 user-created asset or demonstration event |
| POST /api/import/preview | Multipart CSV → ImportPreview; writes source metadata only |
| POST /api/import/commit | Confirmed mapping → 201 ImportReport; replay/conflicting claim returns 409 |
| POST /api/knowledge/upload | Multipart text/PDF → 201 KnowledgeUploadReport; UNVERIFIED user_import |
| GET /api/knowledge; GET /api/knowledge/:id | Source catalogue/details |
| DELETE /api/knowledge/:id | Deletes user-added source; protected origins refused |
| GET /api/fleet/summary; /api/fleet/recurring-faults | Allowlisted SQL aggregates |
| POST /api/admin/ingest | 404 INGEST_DISABLED; trusted offline ingestion only |

Two expensive jobs may run concurrently per app instance. Excess admission returns 503
WORK_CAPACITY_REACHED. When the lifetime logical model-operation allowance is exhausted,
existing deterministic/keyword degradation applies. A successful resolution save does not
promise background indexing admission or completion.

SCADA replay fields come from the stored event, including its original asset. Duplicate
signalSnapshot is empty because signal snapshots are not persisted. An identity already
belonging to another origin returns 409 EVENT_IDENTITY_CONFLICT rather than relabeling it.
The success shapes below are unchanged. SSE may drop oversized frames or disconnect a
backpressured client; it is not a durable delivery log.

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
