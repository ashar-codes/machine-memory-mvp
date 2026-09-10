# Dynamic ingestion

How a turbine, its history and its technical knowledge get into Machine Memory at runtime, and what
the system does and does not promise about them.

The principle throughout: **the machine is the unit of memory.** A document is knowledge *about*
machines. Nothing here is a general-purpose file store or a chat-with-your-PDF feature.

## Two paths in

| Path | Destination | Becomes retrievable through |
| --- | --- | --- |
| Structured import (CSV) | `asset_events`, `maintenance_events`, `work_orders`, `technician_notes` | SQL structured retrieval, immediately |
| Document ingestion (TXT/MD/PDF) | `documents` + `document_chunks` + pgvector | Semantic and keyword retrieval, immediately |

Both write through the same tables the reviewed public corpus and the synthetic seed already use.
There is no parallel store, and retrieval has no special case for imported data.

## Structured imports

### Supported types and fields

`*` marks a field that must be mapped before the import can run.

| Import type | Fields |
| --- | --- |
| `EVENT_LOG` | `asset_code`*, `event_code`*, `title`*, `occurred_at`*, `subsystem`, `severity`, `cleared_at`, `description` |
| `MAINTENANCE_HISTORY` | `asset_code`*, `event_type`*, `occurred_at`*, `component`, `description` |
| `WORK_ORDERS` | `asset_code`*, `summary`*, `event_code`, `root_cause`, `resolution`, `completed_at` |
| `TECHNICIAN_NOTES` | `asset_code`*, `content`*, `created_at` |

This list is the complete allowlist. It is enforced in `backend/src/tabular.ts` and checked again in
`backend/src/mapping.ts` before any write.

### Flow

```
upload CSV → parse → deterministic synonym mapping → Gemini suggests the rest
           → user reviews and edits → validate against allowlist → transactional insert
           → import_batches row records what happened
```

An import is refused outright while a required field is unmapped. Rows are validated individually:
an unreadable timestamp or an unknown asset code rejects that row with a reason and imports the
rest. A rejected row is never coerced — an unparseable date does not silently become "now".

### Limits

- 10 MB and 5,000 rows per file, 80 columns.
- At most 25 rejection reasons are retained per batch, so one bad file cannot fill the database.
- A parsed file is held in memory between preview and commit for 30 minutes, and at most 25 previews
  are held at once.

### Timestamps

ISO 8601, `YYYY-MM-DD HH:mm`, `YYYY-MM-DD`, and `DD/MM/YYYY` or `MM/DD/YYYY` where unambiguous.

**A value with no timezone is read as UTC.** Maintenance exports rarely carry an offset, and reading
them as server-local time would shift every row by the host's offset with no error shown anywhere.
If your export is in local time, convert it before uploading.

### Not supported, deliberately

The interface names these rather than pretending to accept them:

- **SCADA / telemetry at volume.** Bounded event-log subsets only. Millions of signal rows need
  batch processing this MVP does not have.
- **XLSX / XLS / ODS / DOC.** Export as CSV.
- **Scanned PDFs.** There is no OCR. A text PDF or `.txt` works.

## AI-assisted schema mapping

Gemini suggests column mappings. It does not perform the import, and it cannot reach the database.

1. Deterministic synonym matching runs first, over known header spellings (`Turbine_ID`,
   `Alarm_Code`, `Work Performed`, `Date Done`, …). The common case never depends on a network call.
2. Only the columns still undecided are sent to the model, with up to five sample values each.
3. Every suggestion is validated: the field must be a verbatim member of the allowlist for that
   import type, the column must exist in the uploaded file, and a field already taken is refused.
   A suggestion naming `public.assets`, `record_origin`, or `title; drop table assets` is discarded.
4. The user reviews the mapping and can change any row. A hand-edited mapping goes through the same
   gate — the browser is not trusted more than the model.

The suggestion is raced against a 12-second deadline. If the model is slow or unavailable, the
deterministic mapping is shown with a note saying so, and the user maps the rest by hand. **The
import is never blocked by the model.**

Mapping status is qualitative — `High match`, `Suggested`, `Needs review`, `Unmapped`. There is no
numeric confidence, because the system has no calibrated basis for one.

## Document ingestion

```
upload → validate → extract text → paragraph-aware chunking
       → Gemini embedding (gemini-embedding-001, 1536 dimensions, unit-normalized)
       → documents + document_chunks → searchable immediately
```

No restart is needed. The next question retrieves it.

A chunk whose embedding fails validation is stored with a **null** embedding rather than a
fabricated vector. It stays keyword-searchable, and the Knowledge Base shows the source as partially
indexed rather than claiming it is done.

Limits: 15 MB, 120 chunks per document, ~1,200 characters per chunk.

## Provenance

| Origin | Meaning |
| --- | --- |
| `public_data` | Faithful import of a public operational dataset |
| `public_reference` | Reviewed public reference (OSHA, NREL) |
| `synthetic_demo` | Authored fictional demonstration data |
| `user_demo` | A resolution a user entered in the application |
| `user_import` | Anything loaded through the Data Hub |
| `simulation` | A fault deliberately injected in Scenario Lab |

`user_import` and `simulation` were added by `20260910180000_dynamic_ingestion.sql`. The foundation
migration is untouched.

### What an uploaded document is, and is not

An uploaded document is **evidence**. It is not **authority**.

- It is retrievable, rankable and citable, and it appears in answers.
- It is stored as `UNVERIFIED`, and a database CHECK stops a `user_import` document claiming
  `REGULATOR` or `RESEARCH` standing.
- `procedural` in `backend/src/retrieval.ts` still requires a **public** origin. So an uploaded file
  can never satisfy the authoritative-reference safety gate, can never license a torque value, a
  pressure limit or an isolation sequence, and can never lift a safety answer out of `INSUFFICIENT`.
- The synthesis instructions require the model to say when it is relying on unreviewed or simulated
  material, and it does.

This is the distinction that keeps dynamic ingestion safe: **anyone can add knowledge; nobody can
add authority.**

## Security

- Uploads are held in memory. Nothing is written to disk, so there is no temporary file to clean up
  and no path for a filename to traverse. `safeFilename` reduces any name to a display-only
  basename, used for provenance and never to build a path.
- Extension, magic bytes and byte length are all checked. A `.pdf` that does not start with `%PDF-`
  is refused; a `.csv` containing NUL bytes is refused.
- Cells beginning `=`, `+`, `-` or `@` are prefixed with an apostrophe on read. Nothing is ever
  evaluated — the guard exists so a value cannot become a live formula if re-exported.
- No shell execution, no user-controlled paths, no model-chosen destinations.
- Error messages describe the rule that was broken, never the file's contents.

## Fleet queries

The fleet copilot may pick **one** of five predefined operations and supply bounded parameters:
`fault_recurrence`, `open_incidents`, `event_code_assets`, `frequent_faults`,
`faults_after_maintenance`. Backend code maps each to a hand-written parameterized statement.

The model never writes SQL, never names a table or column, and an operation outside the list is
refused rather than defaulted. A numeric parameter is accepted only when the question actually
contains a number; otherwise the documented default applies, because a model asked "which turbines
have recurring faults?" will otherwise invent a threshold and return nothing.

Recurring-fault detection is a counting rule — same asset, same event code, N occurrences in a
window. It is not machine learning and it is not a diagnosis. `faults_after_maintenance` reports
ordering, never causation.

## Demo workflow

1. **Scenario Lab** → Add turbine `WT-10`.
2. **Machine Memory** → its memory is empty, and the copilot says so plainly.
3. **Data Hub** → upload an event-log CSV, review the proposed mapping, import.
4. **AI Copilot** → "Has this happened before?" — recurrence computed in SQL from the imported rows.
5. **Data Hub** → upload maintenance history, import.
6. **AI Copilot** → "How was it solved previously?"
7. **Knowledge Base** → upload a technical document; it is chunked, embedded and indexed.
8. **AI Copilot** → ask something only that document answers; it appears in the citations, labelled
   as unreviewed user-imported material.
