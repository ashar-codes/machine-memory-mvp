

## Demo D — the same engine, on real public data

The closing act. Everything so far was synthetic or uploaded; this is genuine published data.

Opening line: *"Everything you have seen so far was either fictional demonstration data or a file we
uploaded ourselves. Let's point the same engine at real public wind-farm data."*

1. **Fleet**, then the asset rail. Two farms, clearly separated: **Demonstration Wind Farm** and
   **Penmanshiel Wind Farm · PUBLIC DATA**.
2. Say what the synthetic farm is for: a controlled setting where maintenance, resolutions and a
   recurring fault story can be exercised end to end.
3. Open **PEN-T01**. Real Senvion MM82 turbine, from Cubico's published Zenodo dataset, CC-BY-4.0.
   Note there is no PEN-T03 — the published dataset has no turbine 03, and none was invented.
4. **Recorded events** panel: 576 event records, 23 distinct codes, 2023-01-01 to 2023-02-27. Every
   number is a SQL count over imported rows. The frequent codes are real published codes with the
   publisher's own messages.
5. **AI Copilot → asset scope →** *"Summarize this turbine's event history."* Real records, cited.
6. *"Has this event occurred before?"* with `PEN-5000` selected — three genuine occurrences of
   "Breakdown obstacle light", counted in SQL.
7. **The important one.** *"How was this solved previously?"* The answer states that occurrences
   exist but **no verified maintenance resolution is present in this data**. Say why that matters:
   the public dataset has no work orders and no root causes, and the system will not invent one.
   *"Refusing to answer is a feature. It is the difference between a retrieval system and a
   plausible-sentence generator."*
8. *"What do we know about this turbine, and what published material is relevant to it?"* One answer
   combining real operational facts (cited to `public_data`) with OSHA and NREL technical references
   (cited to `public_reference`) — kept visibly separate, with the model noting the published
   material is general and not turbine-specific.

Closing line: *"The same Machine Memory engine that powers our synthetic controlled demo also works
against genuine public wind-turbine operational data — and nothing was trained. The records were
ingested and indexed; Gemini is unchanged."*
