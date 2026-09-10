# Data/RAG agent handoff

## Foundation boundary

Implement ingestion under `scripts/` and the agreed knowledge-ingestion backend boundary; own `data/`. Coordinate backend edits with its owner. Do not change shared API types, database column names or HTTP contracts independently. `docs/API_CONTRACT.md` and `packages/shared/` are authoritative for HTTP. This document freezes the **local ingestion JSON** shape. Database migrations and seed SQL remain Infrastructure ownership.

The foundation provides provenance/source documentation and a synthetic fixture. No public SCADA/technical corpus or vectors have been loaded by this documentation task. Inspect current scripts and database before claiming later stages complete.

## Local ingestion JSON contract v1

Each UTF-8 JSON file contains exactly one document, not an array:

```json
{
  "title": "Document title",
  "organization": "Publisher or authoring organization",
  "sourceUrl": null,
  "sourceType": "TECHNICIAN_NOTE",
  "authorityClass": "UNVERIFIED",
  "recordOrigin": "synthetic_demo",
  "assetType": "wind_turbine",
  "manufacturer": null,
  "model": null,
  "chunks": [
    { "content": "Nonempty reviewed text", "pageNumber": null, "section": "Narrative" }
  ]
}
```

| Field | Rule |
| --- | --- |
| `title`, `organization` | Required nonempty strings; trim whitespace. |
| `sourceUrl` | HTTPS source URL or null; required non-null for public origins. Metadata only: no automatic URL fetching. |
| `sourceType` | `TECHNICAL_REFERENCE`, `SAFETY_REFERENCE` or `TECHNICIAN_NOTE`. |
| `authorityClass` | `OEM`, `REGULATOR`, `RESEARCH`, `HISTORICAL` or `UNVERIFIED`. |
| `recordOrigin` | `public_data`, `public_reference`, `synthetic_demo` or `user_demo`; never infer from URL/domain. |
| `assetType` | Required nonempty applicability identifier, e.g. `wind_turbine`; future types supported. |
| `manufacturer`, `model` | Nonempty strings or null; null means unspecified, not universal machine-specific approval. |
| `chunks` | Required nonempty ordered array of chunks. Preserve ordering on insert. |
| `content` | Required nonempty text; not executable content or instructions to the assistant. |
| `pageNumber` | Positive one-based integer for an actual source page, otherwise null. Never fabricate page numbers for HTML. |
| `section` | Nonempty section label or null. |

Suggested validation ceilings for the implementation: one file up to 2 MiB, at most 200 chunks, each chunk at most 8,000 characters; reject oversize input before embedding. Any final enforced limits belong in script help and API contract where applicable.

Map camelCase inputs into `documents` snake_case fields. Keep `assetType`, `manufacturer`, `model` in document metadata and propagate applicability into chunk metadata as needed by the frozen schema/RPC. Each chunk must reference its actual document ID. Use `gemini-embedding-001` with an explicitly requested `outputDimensionality` of **1,536**, renormalize the truncated vector to unit length, verify returned lengths and finite numbers; never seed random/zero vectors as if semantic embeddings.

Authority assignment is a trusted offline curation task, not a privilege granted to anonymous callers. Synthetic/user demo content must be `UNVERIFIED` or `HISTORICAL`, never OEM/REGULATOR/RESEARCH authority. A `SAFETY_REFERENCE` label alone does not authorize procedural guidance. Review source provenance and domain, text fidelity, publication scope and applicability before public-reference ingestion.

## Next implementation sequence

1. Validate local JSON with Zod, enforce provenance and ceilings, then embed in bounded batches. Keep Gemini/Supabase credentials on the backend/CLI only. Do not log keys or full sensitive content.
2. Insert document and chunks transactionally through a reviewed DB function or SQL transaction; failed embedding/insertion must not leave a document presented as searchable. Design reruns to be idempotent via stable content/source identity; coordinate a schema change if needed rather than inventing an untracked upsert key.
3. Fetch the tiny public static file and bounded event subset only if access permits. Freeze actual CSV mapping after inspecting headers, not from guesses. Verify duplicate handling and counts.
4. Ingest reviewed public references only after their contents are acquired. Preserve verbatim excerpts or clearly marked paraphrases with correct pages/sections, source links, licensing and applicability. No OEM manual is currently available.
5. Retrieve structured history/counts using parameterized SQL separately from semantic chunks. Filter vectors by asset type and manufacturer/model when applicable before evidence fusion. Same event string across unrelated OEMs is not enough to establish equivalence.
6. Keep origins on all evidence. New resolutions persist as `user_demo`; ensure narrative indexing is retried safely and visible as pending/failed if asynchronous. SQL timeline persistence must not be falsely reported as successful semantic indexing.

## Acceptance checks for the later implementation

- Synthetic fixture validates; malformed dimensions, empty chunks, unsafe URL schemes and public origins without source URLs fail.
- No fabricated OEM authority or public origin is accepted through a user-facing route.
- Partial embedding failure leaves no falsely searchable completed document; rerunning does not duplicate evidence.
- Public subset SQL counts match normalized input; UTC assumptions and coverage are explicit.
- Retrieval keeps different manufacturers/models apart; general safety references stay clearly general.
- A saved user resolution can be retrieved with its original origin and stable citation ID.
- Without verified technical/safety references, questions needing numeric limits/procedures remain unsupported.

The Backend Agent owns deterministic safety detection, answer/citation validation and strength scoring. Data/RAG must supply provenance and applicability; it cannot turn weak/synthetic history into high-authority evidence by similarity score.
