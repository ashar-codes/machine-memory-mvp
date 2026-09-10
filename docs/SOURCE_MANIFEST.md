# Source manifest

Rechecked 2026-09-10. **Status distinguishes three different things: catalog verified, content acquired locally, and ingested into a database.** A row is only called ingested when embeddings and rows actually exist in a live database. At this checkpoint no database was reachable, so nothing below is ingested. Never cite a manifest row itself as technical evidence.

## Public operational data

| ID | Source | Verified access and scope | License / authority | Local status |
| --- | --- | --- | --- | --- |
| PEN-V3 | [Penmanshiel wind farm data](https://zenodo.org/records/16807304), Plumley & Takeuchi / Cubico Sustainable Investments Ltd | Record read 2026-09-10. Version v3, published 2025-08-13, DOI [10.5281/zenodo.16807304](https://doi.org/10.5281/zenodo.16807304). 7.5 GB total. 10-minute SCADA and events for 14 Senvion MM82 turbines, 2016 to end of 2024. Record states there is no turbine WT03. | CC BY 4.0; public historical operational data | Catalog verified. Bulk SCADA archives **not downloaded**. |
| PEN-STATIC | [Penmanshiel_WT_static.csv](https://zenodo.org/records/16807304/files/Penmanshiel_WT_static.csv?download=1) | **Acquired 2026-09-10.** 2,029 bytes. MD5 `c4cd4191234c1a67a391fe5d2978256b` computed locally and matches the checksum Zenodo publishes for the file. Stored at `data/raw/Penmanshiel_WT_static.csv`. Contains 14 turbine rows: identity, manufacturer, model, rated power, hub height, rotor diameter, coordinates, elevation, country, commercial operations date. | Inherits PEN-V3 attribution and license | **Acquired and checksum-verified. Not yet imported to a database** (no credentials this session). Importer: `npm run data:penmanshiel`. |

The static file carries **identity and siting only**. It contains no fault codes, no events and no maintenance history, so imported Penmanshiel turbines legitimately have empty timelines. Recurrence, incidents and resolutions in this MVP come from the clearly labelled synthetic farm. No public event was fabricated to fill the gap.

Bulk SCADA was deliberately not acquired: the smallest relevant archive is 55.9 MB and the release is 7.5 GB, which is disproportionate to a demonstration whose fault narrative is synthetic by design. Should a later phase want real events, extract a bounded window from a single yearly archive, keep raw event codes and source timezone, cap extracted rows, reject archive traversal and symlinks, and record a rejected-row report before inserting anything.

## Public reference corpus

| ID | Source | Verified access and scope | Authority / type | Local status |
| --- | --- | --- | --- | --- |
| OSHA-WIND-LOTO | [Green Job Hazards — Wind Energy: Lockout/Tagout](https://www.osha.gov/green-jobs/wind-energy/lockout-tagout), OSHA | Page read in full 2026-09-10. Covers the purpose of lockout/tagout, injury statistics OSHA cites, the wind-turbine servicing hazard, the applicable standards it names (29 CFR 1910.269(d) and 1910.147), and the listed procedure requirements. | REGULATOR / SAFETY_REFERENCE / `public_reference` | Manifest prepared: `data/knowledge/osha-wind-lockout-tagout.json`, 6 chunks. Schema-validated. **Not ingested.** |
| OSHA-269 | [29 CFR 1910.269](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.269), OSHA | Paragraph (d) scope, the (d)(1) note on commingled installations, documented-procedure contents, and the annual certified inspection read 2026-09-10, with the job-briefing requirement from OSHA's [hazardous energy control eTool](https://www.osha.gov/etools/electric-power/hazardous-energy-control). | REGULATOR / SAFETY_REFERENCE / `public_reference` | Manifest prepared: `data/knowledge/osha-1910-269-hazardous-energy.json`, 6 chunks. Schema-validated. **Not ingested.** |
| NREL-80195 | [Wind Turbine Drivetrain Reliability and Wind Plant Operations and Maintenance Research and Development Opportunities](https://www.nrel.gov/docs/fy21osti/80195.pdf), Keller, Sheng, Guo, Gould & Greco, NREL/TP-5000-80195, September 2021 | Full report read 2026-09-10. Chunks drawn from the introduction (O&M cost share, dominant downtime contributors), §2 premature failure, §2.1.1.1 pitch bearing fatigue/wear/frictional corrosion and its open questions, and §2.2 data analytics and PHM. Page numbers recorded from the PDF's own numbering. | RESEARCH / TECHNICAL_REFERENCE / `public_reference` | Manifest prepared: `data/knowledge/nrel-tp-5000-80195-drivetrain-reliability.json`, 9 chunks. Schema-validated. **Not ingested.** |

All three manifests store **paraphrases with attribution**, not verbatim reproduction, and each ends with an explicit applicability-limits chunk stating that the material contains no asset-specific values and authorizes no work. Page numbers appear only for the NREL PDF, which genuinely has them; the OSHA HTML chunks use `null` rather than an invented page.

Jurisdiction matters and is not resolved by ingestion: OSHA is a United States regulator. Its material is legitimate general safety evidence and must never be presented as the governing legal procedure for a UK or Pakistani site.

## Ingesting the corpus

```bash
npm run rag:ingest:corpus -- --dry-run   # validates every manifest, no embeddings, no writes
npm run rag:ingest:corpus                # embeds and inserts; requires OPENAI_API_KEY and DATABASE_URL
```

Each file still passes through the same single-document trust boundary as `npm run rag:ingest -- --file <path>`: Zod validation, provenance and authority checks, size ceilings, dimension validation and a transactional insert keyed by content identity, so reruns do not duplicate. Only after that command reports `"status":"ingested"` may this manifest's local status be changed to ingested.

Excluded on purpose: proprietary or leaked OEM manuals, Senvion service documentation, confidential plant records, and any source that could not be read directly from its publisher.
