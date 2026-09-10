# Local knowledge input

`synthetic-note.example.json` demonstrates one document in the frozen local ingestion format. It can exercise validation/embedding when the database and Gemini credentials are configured, but cannot provide authoritative safety or OEM evidence.

Use `npm run rag:ingest -- --file data/knowledge/synthetic-note.example.json` from the repository root after setup. Review the root command implementation/status before assuming successful ingestion. Each JSON file is a single document with presegmented chunks. A source URL is provenance metadata, not an instruction to fetch it.

Read `../../docs/DATA_RAG_HANDOFF.md` for field rules and production follow-up requirements.

Three reviewed public reference manifests live here alongside the synthetic fixture:
`osha-wind-lockout-tagout.json`, `osha-1910-269-hazardous-energy.json` and
`nrel-tp-5000-80195-drivetrain-reliability.json`. Each stores attributed paraphrases with a source
URL, an authority class and a closing chunk stating what the material does not establish. They are
prepared but not embedded; ingest with `npm run rag:ingest:corpus`. Until that command reports
success, do not describe the corpus as ingested anywhere.
