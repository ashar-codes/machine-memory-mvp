# Data directories

- `raw/`: immutable acquired source files and acquisition manifests. No public files have been acquired in this foundation phase.
- `derived/`: traceable normalized subsets and rejected-row reports. Never rewrite raw sources.
- `synthetic/`: fictional demo fixtures; every persisted record must be `synthetic_demo`.
- `knowledge/`: reviewed local JSON ingestion inputs. The example is synthetic, not an authoritative reference.

Database seed SQL lives in `supabase/seed/`; do not duplicate the complete seed as another drifting data source. Read `../DATA_PROVENANCE.md` before importing data.
