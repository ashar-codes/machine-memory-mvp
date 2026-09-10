# Machine Memory API contract v1 — frozen

> **Amendment 1.1 (2026-09-10), the only change since freeze.** `HealthResponse.phase` was widened from `'foundation'` to `'foundation' | 'mvp'` and the server now reports `'mvp'`. Reason: the investigation pipeline is implemented, and a health field that still said `foundation` would misreport completion status. No field was renamed, removed or retyped; no request shape changed. Propagated together in `packages/shared/src/index.ts`, `backend/src/app.ts`, this document and `tests/integration/http.test.ts`.

Effective 2026-09-09. Wire JSON is camelCase; DB columns are snake_case. Exact TypeScript shapes live in `packages/shared/src/index.ts`. Shared package is architect-owned. These are success contracts, including endpoints awaiting implementation; see implementation status below. No silent changes during agent work.

## Transport and common rules

Local backend `http://127.0.0.1:3001`; Vite browser uses same-origin `/api` via proxy. JSON only for POST, 32 KiB request body limit. UUIDs are strings; timestamps ISO 8601 UTC strings; unknown values use null, not invented text. Asset codes match `[A-Za-z0-9_-]{1,64}` and are case-sensitive globally unique IDs. Event codes max100 characters. No login in foundation: bind only loopback and reject other Host/browser Origin values. This is not authorized for public deployment.

Lists accept `limit` (integer1–100 default25), `offset` (integer0–10000 default0). Response `{items:T[],limit,offset,hasMore}` uses limit+1 query; this is a page indicator, not total rows. List counts must not be presented as whole-history counts. Arrays sort deterministically; histories newest timestamp then ID. Empty collections return200. Missing selected asset returns404. `GET /api/assets` sorts assetCode ascending. Unknown input properties rejected on POST and query parameters.

Errors: `{error:{code:string,message:string,requestId:string}}`. 400 invalid request; 403 blocked origin/host; 404 asset/route absent or ingest disabled; 413 body too large; 415 unsupported media; 429 rate limit; 503 missing DB or incomplete investigation; 500 sanitized internal failure. No stack traces, SQL strings, credentials or model provider internals in responses.

## Routes

| Route | Success body | Foundation status |
| --- | --- | --- |
| GET /api/health | HealthResponse | Implemented; always200, status may degraded |
| GET /api/assets | ListResponse<Asset> | Implemented SQL; needs database |
| GET /api/assets/:assetCode | `{asset:Asset}` | Implemented SQL |
| GET /api/assets/:assetCode/timeline | ListResponse<TimelineItem> | Events, maintenance, notes, saved resolutions |
| GET /api/assets/:assetCode/incidents | ListResponse<Incident> | Implemented SQL |
| GET /api/assets/:assetCode/current-event | `{event:AssetEvent|null}` | Latest uncleared event; null if none |
| POST /api/investigate | InvestigateResponse | **Implemented.** Hybrid structured + semantic retrieval, deterministic safety/strength, grounded synthesis, citation validation |
| POST /api/resolutions | ResolutionResponse,201 | Transactional SQL persistence; semantic indexing attempted after the response, never reported as complete |
| POST /api/admin/ingest | ErrorResponse,404 INGEST_DISABLED | Disabled in all environments; offline CLI only |

Health returns `service:machine-memory`, `phase:mvp`, database `not_configured|connected|unavailable`, llm `not_configured|configured_unverified`. A configured key is not proof of model access. Health is liveness/configuration; it does not verify migrations, corpus or answer correctness.

## Investigate

```json
{"assetCode":"WT-07","eventCode":"PITCH-HYD-214","intent":"HISTORY","question":"Has this happened before?"}
```

`eventCode` optional; `intent` required: HISTORY, PREVIOUS_RESOLUTION, SIMILAR_INCIDENTS, RECENT_CHANGES, TECHNICAL_GUIDANCE, GENERAL, SAFETY. Question required trimmed1–2000 characters. Client intent is a hint: safety scans question regardless of chosen intent. Never let a caller bypass safety with HISTORY.

```json
{"answer":{"summary":"Insufficient verified evidence.","findings":[],"evidenceStrength":"INSUFFICIENT","uncertainties":["No applicable verified evidence is available."],"safetyStatus":"INSUFFICIENT"},"evidence":[]}
```

Each finding has `title`, `detail`, `citationIds:string[]`. Each evidence has `id,title,sourceType,authorityClass,excerpt,assetCode,timestamp,recordOrigin,sourceUrl`; assetCode/timestamp/sourceUrl nullable. Origins exactly public_data, public_reference, synthetic_demo, user_demo. Strength HIGH/MODERATE/INSUFFICIENT; safety NORMAL/REFUSED/INSUFFICIENT. All cited IDs must occur in supplied evidence; reject entire generated answer on unknown IDs or unsupported uncited factual findings. Strength and safety are assigned by backend, never trusted from model output.

Never return a success-shaped answer that is not backed by retrieved evidence. With no database configured, investigate returns503 `DATABASE_NOT_CONFIGURED` rather than a fabricated result; `INVESTIGATION_NOT_IMPLEMENTED` is retired. Forbidden bypass requests may return200 REFUSED without database or LLM; no procedural content. When the model provider fails or returns unusable output, the backend answers deterministically from the evidence it retrieved and never claims model synthesis occurred.

Evidence IDs are `EV-1`, `EV-2`, ... assigned in presentation order for one response. They are stable within a response only and must not be stored or compared across responses.

## Save resolution

```json
{"assetCode":"WT-07","eventCode":"PITCH-HYD-214","rootCause":"Demo diagnosis","resolutionSummary":"Demo maintenance result","component":"Pitch assembly","downtimeMinutes":47,"notes":"Student-entered demonstration","validated":true}
```

Required strict fields: assetCode,eventCode; rootCause/resolutionSummary1–4000 chars; component1–200; notes0–4000; downtimeMinutes integer0–525600; validated boolean. Server sets assetId, UUID, createdAt, and **user_demo** origin. `validated` records the student's assertion only; it grants no authority or safety verification. No origin/authority fields accepted from caller. Each POST creates one append-only resolution; client must not auto-retry ambiguous timeouts (no idempotency key in v1). Existing records are never overwritten.

```json
{"resolution":{"id":"UUID","assetId":"UUID","assetCode":"WT-07","eventCode":"PITCH-HYD-214","rootCause":"Demo diagnosis","resolutionSummary":"Demo maintenance result","component":"Pitch assembly","downtimeMinutes":47,"notes":"Student-entered demonstration","validated":true,"recordOrigin":"user_demo","createdAt":"2026-09-09T12:00:00.000Z"},"timelineRefresh":{"assetCode":"WT-07","url":"/api/assets/WT-07/timeline"},"memoryStatus":"STRUCTURED_SAVED_SEMANTIC_PENDING"}
```

Timeline includes the new record immediately after commit; vector embedding is explicitly pending. Backend/Data-RAG handoff must implement deterministic pending-record scanning/retries without changing this enum silently.

## Ingest boundary

Reserved future input type `{manifestPath:string}` is not accepted by HTTP in v1. `POST /api/admin/ingest` always404. Local `npm run rag:ingest -- --file <reviewed-json> [--dry-run]` follows docs/DATA_RAG_HANDOFF.md. No URL fetching, file upload or filesystem path access from a network request.

## Amendment 2.0 (2026-09-10) — dynamic Machine Memory

Additive. Every route and shape above is unchanged; `RecordOrigin` gained two members.

`RecordOrigin` now also includes `user_import` (loaded through the Data Hub) and `simulation` (a
fault injected in Scenario Lab). Clients that switch exhaustively on origin must handle both.

| Route | Success body | Notes |
| --- | --- | --- |
| POST /api/assets | `{asset:Asset}`, 201 | Server sets `user_import` origin. 409 `ASSET_EXISTS` on a duplicate code. |
| POST /api/events | `{event:AssetEvent}`, 201 | `simulation:boolean` required. True stores `simulation` origin, false stores `user_demo`. Recomputes asset status. |
| GET /api/assets/:assetCode/memory-status | `{assetCode,empty,counts}` | Drives the empty-state prompt for a newly onboarded turbine. |
| POST /api/import/preview | `ImportPreview` | multipart/form-data: `file` + `importType`. Parses, stores a `data_sources` row, proposes a mapping. Nothing is written to history. |
| POST /api/import/commit | `ImportReport`, 201 | Validates the confirmed mapping against the allowlist, then imports transactionally. 410 `PREVIEW_EXPIRED` after 30 minutes. |
| POST /api/knowledge/upload | `KnowledgeUploadReport`, 201 | multipart/form-data. Chunks, embeds and indexes. Stored UNVERIFIED with `user_import` origin. |
| GET /api/knowledge | `ListResponse<KnowledgeSource>` | Paginated catalogue. |
| GET /api/knowledge/:id | `KnowledgeDetail` | Metadata plus bounded chunk previews. |
| DELETE /api/knowledge/:id | `{status:'deleted'}` | 403 `SOURCE_PROTECTED` for public and synthetic sources. |
| POST /api/copilot | `CopilotResponse` | `scope:'asset'\|'fleet'`. Asset scope requires `assetCode` and reuses the investigate pipeline unchanged; `history` is bounded to 6 turns server-side. Fleet scope returns a `plan` naming the predefined operation that ran. |
| GET /api/fleet/summary | `FleetSummary` | Live counts only. |
| GET /api/fleet/recurring-faults | `{items:RecurringFault[]}` | Optional `minimumOccurrences` (2–10) and `days` (1–3650). |

New error codes: `ASSET_EXISTS` 409, `UPLOAD_REJECTED` 400, `FILE_UNREADABLE` 400, `IMPORT_FAILED`
400, `INVALID_MAPPING` 400, `IMPORT_TYPE_MISMATCH` 400, `PREVIEW_EXPIRED` 410, `SOURCE_PROTECTED`
403, `SOURCE_NOT_FOUND` 404, `DOCUMENT_UNREADABLE` 400, `PDF_UNREADABLE` 400.

Upload routes accept multipart/form-data; every other POST remains JSON only. Fleet-scope answers
carry findings with empty `citationIds`, because they cite computed rows rather than evidence
records; asset-scope answers keep the existing citation-validation guarantee.
