# Data provenance

## Current checkpoint — 2026-09-10

This repository contains a university demonstration, not confidential operational data. It contains no Zephyr Wind Power Plant data. Demo turbine histories, event codes, root causes, maintenance actions, work orders, component replacements and technician narratives are fictional. `PITCH-HYD-214` is a demo code, not a verified OEM fault definition.

What changed at this checkpoint, stated precisely:

- **One real public file is now in the repository.** `data/raw/Penmanshiel_WT_static.csv` was downloaded from Zenodo record 16807304 and its MD5 matches the checksum Zenodo publishes for that file (`c4cd4191234c1a67a391fe5d2978256b`). The file is published with CRLF line endings, and a repository-wide `*.csv text eol=lf` rule was silently rewriting them on checkout, which broke that byte-exact match; the file is now marked `binary` in `.gitattributes` so Git preserves the published bytes. It holds 14 genuine turbine identities with coordinates and ratings. It contains no SCADA signals and no events.
- **No public event history exists anywhere in this project.** The bulk SCADA archives were not downloaded. No public fault, incident or repair row has been created, and none was invented to compensate.
- **The public importer still has not been run against a database.** `npm run data:penmanshiel` is implemented and its parsing is tested against the real file, and the database is now reachable, but the import has not been executed. No `public_data` row exists yet, so the 14 real Penmanshiel turbine identities are absent from the workspace and only the three synthetic assets appear.
- **Three public reference manifests are now ingested.** The OSHA lockout/tagout page, 29 CFR 1910.269 hazardous-energy provisions and NREL/TP-5000-80195 were each read from their publishers and paraphrased into reviewed manifests under `data/knowledge/`, then embedded with `gemini-embedding-001` and inserted transactionally: 3 documents, 21 chunks, every chunk carrying a non-null 1536-dimension unit-length vector and `record_origin = public_reference`. Ingestion is idempotent by content identity, so re-running reports `already_ingested` rather than duplicating.

## Mandatory origins

| Stored `record_origin` / API `recordOrigin` | Meaning | Restrictions |
| --- | --- | --- |
| `synthetic_demo` | Authored or generated fictional demo data | Label in UI, citations, exports and answers; cannot establish real-world safety or technical truth. |
| `user_demo` | A user entered a resolution/note in this demo | Preserve even when `validated=true`; validation is a demo checkbox, not independent engineering approval. |
| `public_data` | Faithful import or traceable transformation of a public operational dataset | Preserve source identity, version, original row/key and transformation provenance. Never invent missing fields. |
| `public_reference` | Verified text from an attributed public reference | Requires reviewed content, source URL, authority and applicability. A discovered URL alone is not evidence. |

Origin and authority are separate. A regulator's verified publication can be `public_reference` plus `REGULATOR`. An invented note stays `synthetic_demo` plus `UNVERIFIED`, even if it resembles a maintenance procedure. Historical outcomes do not become technical instructions.

Keep public observations and synthetic enrichments in separate rows. Never overwrite a public event with an invented root cause. Synthetic incident/work-order rows can reference a public event only with their own origin preserved and the relationship described as fictional enrichment.

## Public dataset attribution and limits

Verified record: Charlie Plumley and Roberta Takeuchi / Cubico Sustainable Investments Ltd, *Penmanshiel wind farm data*, version **v3**, published 2025-08-13, DOI [10.5281/zenodo.16807304](https://doi.org/10.5281/zenodo.16807304), [official record](https://zenodo.org/records/16807304), released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The record describes 14 Senvion MM82 turbines with 10-minute SCADA and events data from 2016 to the end of 2024, and states that there is no turbine WT03.

Attribution for the one file used: *Penmanshiel wind farm data* (v3) by Plumley & Takeuchi, Cubico Sustainable Investments Ltd, CC BY 4.0, file `Penmanshiel_WT_static.csv`, MD5 `c4cd4191234c1a67a391fe5d2978256b`, retrieved 2026-09-10. Nothing in the file was altered; the importer maps its columns without adding values. This does not imply Cubico endorsement of this project.

**The real dataset has no WT03. The synthetic demonstration farm's WT-03 is fictional and unrelated to it.** Public turbines are imported into a separate site with `PEN-` prefixed asset codes precisely so no display code can accidentally join a fictional turbine to a real one.

Before distribution of an imported subset, retain creator, title, DOI, license link, source filenames, source checksums, access date and a clear description of changes. Do not imply Cubico endorsement. Any selected time window is a subset: recurrence counts describe only that loaded coverage, not lifetime totals.

## Import provenance contract

For public rows, preserve in `source_metadata` or the owning table's `metadata`: `source_url`, `source_version`, `source_file`, `source_sha256`, `original_asset_code`, `original_record_id` or `original_row_number`, `coverage_start`, `coverage_end`, `source_timezone`, `imported_at`, `transform_version`, `license`. Where a table lacks metadata, link to its source event/document and retain these fields in the derived import manifest. All dates use ISO 8601; normalize to UTC only when the source timezone is known. Reject or quarantine ambiguous timestamps instead of silently appending `Z`.

Do not map every low-power SCADA row to a fault. Do not treat every event as a distinct incident, infer repairs from clearance, or merge repeated signal rows without a documented deterministic event definition. Record dropped/rejected rows and deduplication rules. Public imports should use a separate site/namespace from fictional demo assets; do not accidentally join a fictional WT-07 to a real turbine solely by display code.

## Knowledge boundaries

The committed JSON knowledge fixture is synthetic and unverified. It tests ingestion shape only. Real technical and safety references require reviewed source text, applicability metadata and ingestion checks before being usable evidence. OSHA is a US regulator; material must not be presented as the applicable legal procedure for a Pakistan/UK site. General safety guidance is not an asset-specific OEM procedure or permission to operate machinery.

See [source manifest](docs/SOURCE_MANIFEST.md) and [Data/RAG handoff](docs/DATA_RAG_HANDOFF.md).

## What leaves this machine

Ingestion and question answering send content to Google's Gemini API over the free tier. Exactly three categories of content are involved, and it is worth being blunt about which is which:

- **Real and public.** Reviewed OSHA and NREL excerpts (embedded once at ingestion) and Penmanshiel turbine identity fields. These are already published material.
- **Synthetic.** The Demonstration Wind Farm history, WT-07, `PITCH-HYD-214`, its work orders, technician note and resolution records. Fictional throughout, and labelled `synthetic_demo` in the evidence bundle the model receives.
- **User demo.** Resolution text a technician types into the running application, labelled `user_demo`.

No confidential Zephyr data and no E-SET production data exist in this project, so neither can be sent. Free-tier provider terms are not equivalent to commercial terms; see SECURITY.md. This arrangement is acceptable *because* the corpus is public and fictional, and that reasoning does not carry over to real plant data.

## Dynamic data (v2)

Two origins were added for runtime ingestion. Neither is ever treated as reviewed public reference.

| Origin | What it is |
| --- | --- |
| `user_import` | Turbines, history and documents loaded through the Data Hub |
| `simulation` | A fault deliberately injected in Scenario Lab for demonstration |

The existing distinction is unchanged and still holds:

- **Real and public.** Penmanshiel turbine metadata (byte-verified against Zenodo), OSHA lockout/
  tagout and 29 CFR 1910.269, NREL/TP-5000-80195.
- **Synthetic.** Demonstration Wind Farm, WT-07 and its `PITCH-HYD-214` history, the demo work
  order, technician note and maintenance records.
- **User demo.** Resolutions entered through the application.
- **User import.** Anything a user uploads — including the demonstration `WT-10` turbine, its
  gearbox event log and maintenance history, and any technical document indexed at runtime. These
  are fictional demonstration files authored for the demo, not operational records.
- **Simulation.** Faults injected in Scenario Lab.

An uploaded document is stored UNVERIFIED and can never act as procedural authority, however
authoritative its title sounds. Synthetic WT-07 history is never presented as genuine Penmanshiel
or Zephyr history, and imported demonstration data is never presented as either.
