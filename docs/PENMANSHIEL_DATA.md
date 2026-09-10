# Penmanshiel public dataset

Genuine public wind-turbine operational data, integrated so Machine Memory can be shown reasoning
over real records and not only synthetic ones.

## Source

| | |
| --- | --- |
| Dataset | Penmanshiel wind farm data, **v3** |
| Publisher | Cubico Sustainable Investments Ltd (released by Charlie Plumley and Roberta Takeuchi) |
| Record | https://zenodo.org/records/16807304 |
| DOI | 10.5281/zenodo.16807304 |
| License | **CC-BY-4.0** |
| Published | 13 August 2025 |
| Scope | 14 Senvion MM82 turbines, 2016–2024. **There is no turbine WT03.** |

Attribution is stored on every imported row: `Cubico Sustainable Investments Ltd via Zenodo record
16807304`, together with the licence.

## What was downloaded, and what was not

The full record is ~7.5 GB across 29 files. This project deliberately took the smallest unit that
contains real turbine events.

| File | Size | Used |
| --- | --- | --- |
| `Penmanshiel_WT_static.csv` | 2.0 kB | Yes — turbine identity and siting (already in `data/raw/`) |
| `Penmanshiel_SCADA_2023_02_WT_01-10_5981.zip` | 61 MB | Yes — for the status exports inside it |
| `Penmanshiel_WT_dataSignalMapping.xlsx` | 19 kB | Consulted for field semantics; not imported |
| Everything else (~7.4 GB of SCADA/PMU/grid archives) | — | **Not downloaded** |

The 61 MB archive is **not committed**. It contains, per turbine, a 42 MB `Turbine_Data_*.csv` of
10-minute SCADA signals and a ~55 kB `Status_*.csv` of events. Only the status files were extracted;
the archive was then discarded.

Archive sha256: `8068087be360e624da3fbdb2dfd2f17112534b81adc3895d2498d550a3c83ee9`

## Committed subset

`data/raw/penmanshiel/` holds two status exports, unmodified:

| File | Bytes | sha256 |
| --- | --- | --- |
| `Status_Penmanshiel_01_2023-02-01_-_2023-03-01_1042.csv` | 55,320 | `ab631b25bd98611224d4f5e824939555ce053496841ebb3bcd814a0d0ccce7db` |
| `Status_Penmanshiel_02_2023-02-01_-_2023-03-01_1043.csv` | 57,386 | `33bb5026cd3d6bafc9a66278c3a94b9f65785fd9a87f858d74e1cad1290dbbbd` |

They are published with **CRLF** line endings. `.gitattributes` marks the directory `binary` so the
repository-wide `*.csv text eol=lf` rule cannot silently rewrite them, and a test asserts the CRLF
survives checkout. Do not edit these files.

`data/derived/penmanshiel/penmanshiel_status_events.csv` is generated output — a normalized,
inspectable view of exactly what gets imported. Regenerate it, never hand-edit it.

## Source schema

Exported by Greenbyte. Each file begins with a `#` comment header declaring the turbine, turbine
type, **time zone (UTC)** and exported interval, then:

```
Timestamp start, Timestamp end, Duration, Status, Code, Message, Comment,
Service contract category, IEC category, Global contract category, Custom contract category
```

`Timestamp end` and `Duration` are `-` when the source recorded no value. The parser refuses a file
whose columns have changed, or whose header no longer declares UTC, rather than importing
timestamps in an unknown zone.

## Transformations

| Source | Stored as | Note |
| --- | --- | --- |
| `Penmanshiel 01` (header) | asset `PEN-T01` | Prefixed so a real turbine cannot be confused with the fictional `WT-03`/`WT-07` |
| `Code` e.g. `5000` | `event_code` `PEN-5000` | Namespaced; the unprefixed code is kept in `source_metadata.sourceCode` |
| `Message` | `title` and `description` | Verbatim |
| `Timestamp start` / `end` | `occurred_at` / `cleared_at` | Read as UTC, as the header declares |
| `Status` | `severity` **and** `source_metadata.sourceStatus` | See below |
| `Duration`, `Comment`, `IEC category`, contract categories | `source_metadata` | Verbatim |

### Severity is deliberately conservative

The published data classifies rows as **Informational**, **Warning** or **Stop**. It has no notion
of "critical", so this importer can never produce one:

- `Informational` → `info`
- `Warning` → `warning`
- `Stop` → `warning` (a stop affects availability; calling it critical would be an interpretation
  the source does not support)

The verbatim source status is preserved either way and is what the interface displays. A test
asserts no input can produce `critical`.

## What this dataset does not contain

**No work orders. No confirmed root causes. No repair narratives. No technician notes.**

That absence is preserved, not filled in. Asking "How was this solved previously?" about a real
Penmanshiel event returns:

> `PEN-5000` has 2 recorded previous occurrences on PEN-T01, but no verified maintenance resolution
> is present for it in the current data.

This is a feature. Resolutions in this project come only from the clearly labelled synthetic demo
farm and from what a user enters live.

## Imported subset

| | |
| --- | --- |
| Site | Penmanshiel Wind Farm, `record_origin = public_data` |
| Assets | 14 turbine identities; **2** with event history (`PEN-T01`, `PEN-T02`) |
| Source turbines | Penmanshiel 01, Penmanshiel 02 |
| Event rows | **1,172** (576 + 596) |
| Period | 2023-01-01T04:20:33Z → 2023-02-27T07:36:51Z |
| Distinct source codes | 31 |
| Source statuses | Informational, Stop, Warning |
| SCADA signal rows | **0** — deliberately not imported |

The period starts before February because one genuine long-running warning began on 1 January and
was still open when the exported window opened. That row is kept as published.

## Commands

```bash
npm run data:penmanshiel                              # turbine identities from the static file
npm run data:penmanshiel -- --events --dry-run        # parse and report; no database writes
npm run data:penmanshiel -- --events                  # import the real event history
npm run data:penmanshiel -- --events --emit-derived   # also regenerate the derived CSV
```

Both stages are idempotent. Re-running reports `alreadyPresent` and inserts nothing: identity by
`(event_source, external_event_id)`, where the external id is
`<sourceTurbine>:<startedAt>:<sourceCode>` — deterministic, never a fuzzy timestamp match.

To import more turbines or a different month, download another archive from the record, extract its
`Status_*.csv` files into `data/raw/penmanshiel/`, and re-run. Nothing else changes.

## We are not training anything

Gemini is unchanged by any of this. Nothing is fine-tuned, and no model weights are touched.

What happens is **ingest and index**:

- Structured event rows land in PostgreSQL and become searchable by ordinary SQL — recurrence
  counts, periods, code frequencies.
- Reviewed public reference *text* (OSHA, NREL) is what gets embedded into pgvector.

Operational events are **not** embedded. They are retrieved structurally, which is why a count of
occurrences is a SQL `count(*)` and not something a model estimated.

## Limitations

- Two turbines and one month. Bounded on purpose; the record holds nine years.
- No SCADA signals imported. The 10-minute data is 42 MB per turbine per month and would make the
  repository unusable for a demonstration, with no benefit to a retrieval system.
- No maintenance, resolution or root-cause data exists in this dataset, so none is shown.
- `severity` is a conservative mapping, not a source field. Always read `sourceStatus` for what the
  publisher actually said.
- Machine Memory does not analyse raw signals and does not detect anomalies. It reasons over
  recorded events. See `docs/SCADA_INTEGRATION.md`.
