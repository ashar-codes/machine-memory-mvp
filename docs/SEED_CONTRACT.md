> Historical foundation design notes. Later live checks and outstanding gates are recorded in
> [REMEDIATION_STATUS.md](REMEDIATION_STATUS.md) and the [current checkpoint table](../PROJECT_CONTEXT.md).
> References below to unverified seed/schema work describe the original foundation stage.

# Seed and provenance contract

`supabase/seed/demo.sql` is a transactional, repeatable seed. Every row is explicitly synthetic_demo. Stable UUIDs plus `ON CONFLICT(id) DO NOTHING` preserve existing records on rerun. The seed is not a reset; modifying seed text does not overwrite previously inserted rows.

The site is **Demonstration Wind Farm**, a fictional university setting. It is not Zephyr or Penmanshiel. Manufacturer, model and fault codes are fictional. No real plant record is claimed. Public source ingestion is separate and must preserve source URLs, source licensing and source identity.

| Table | Initial rows |
|---|---:|
| sites | 1 |
| assets | 3 |
| components | 1 |
| asset_events | 5 |
| incidents | 4 |
| work_orders | 1 |
| maintenance_events | 2 |
| technician_notes | 1 |
| resolutions | 1 |
| documents | 0 |
| document_chunks | 0 |
| investigations | 0 |

Assets: WT-07 (fault), WT-03 (operational), WT-11 (warning). UUIDs have prefix `20000000-0000-4000-8000-` and tails `000000000007`, `000000000003`, `000000000011` respectively. Site UUID is `10000000-0000-4000-8000-000000000001`.

WT-07 / PITCH-HYD-214 has **three event occurrences total: two cleared previous occurrences and one current open occurrence**, at 2026-07-03 08:00Z, 2026-08-15 10:00Z and 2026-09-09 08:20Z. WT-03 has one matching historical event. Fleet total for this code is four, across two assets. WT-11's unrelated GEN-TEMP-108 tests metadata separation. Count events from asset_events, not by summing duplicate incident/work-order/note representations.

One historical WT-07 resolution reports 47 fictional downtime minutes. Recent changes include a sensor replacement and inspection. Historical narratives do not authorize maintenance and cannot establish a current diagnosis. No fabricated public safety document or synthetic embedding is seeded.

## Import contracts

Rows use database snake_case fields. Public structured-data adapters map inspected input into these SQL fields and explicit record_origin. Offline knowledge JSON instead uses the camelCase contract in docs/DATA_RAG_HANDOFF.md. A public source adapter must assign deterministic IDs, store original source identification and timestamps in source_metadata, verify turbine mapping, and avoid merging public identities into synthetic assets. Public documents use public_reference, HTTPS source_url, meaningful source_type/authority_class, and ingestion metadata. Chunks carry the same origin as their parent and a unique zero-based chunk_index. Embedding model and dimension belong in metadata. Unembedded chunks retain null embedding.

User-created resolutions must use user_demo regardless of any client-provided origin. Logging a resolution does not clear an event, validate engineering work, or change equipment state. Inserted resolutions appear through direct structured SQL immediately; semantic reindexing may follow separately.

This seed has not been applied to a live Supabase database. Treat fixture counts as expected, pending live verification.

## Public import, added 2026-09-10

`npm run data:penmanshiel` is a **separate** operation from the synthetic seed and inserts into a
separate site: `Penmanshiel Wind Farm`, site UUID `11000000-0000-4000-8000-000000000001`, with
`record_origin = 'public_data'`. It reads `data/raw/Penmanshiel_WT_static.csv`, verifies the file's
MD5 against the checksum published with Zenodo record 16807304, and refuses to import if the
checksum or the CSV header does not match.

| Table | Rows added by the public import |
|---|---:|
| sites | 1 |
| assets | 14 (`PEN-T01`, `PEN-T02`, `PEN-T04` … `PEN-T15`) |
| everything else | 0 |

There is no `PEN-T03`, because the published dataset has no turbine 03. The synthetic farm's
`WT-03` is fictional and unrelated; the two are never joined, and the `PEN-` prefix exists so that
a display code can never accidentally bridge them.

Public turbines have **no events, incidents, work orders, resolutions or notes**, because the
static file contains none. An empty timeline on a public turbine is correct behaviour. Do not
enrich these rows with synthetic history: if a future phase adds real events from the SCADA
archives, they must arrive as `public_data` with their original event codes and source timezone
preserved, and any synthetic enrichment must remain in its own rows with its own origin.

Both operations are idempotent. Rerunning the import inserts nothing new and reports
`alreadyPresent`.
