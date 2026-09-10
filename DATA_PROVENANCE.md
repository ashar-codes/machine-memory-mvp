

## Real Penmanshiel operational data (v2.3)

The public importer has now been run. `data/raw/penmanshiel/` holds two official Greenbyte status
exports, committed unmodified with their published CRLF endings and recorded sha256 sums, and
`npm run data:penmanshiel -- --events` imported **1,172 genuine event rows** for `PEN-T01` and
`PEN-T02` covering 2023-01-01 to 2023-02-27, across 31 distinct published source codes.

Everything carries `record_origin = public_data` on a separate site, `Penmanshiel Wind Farm`, and is
never merged with the fictional Demonstration Wind Farm.

Three honesty rules govern this data:

- **No fabricated severity.** The source classifies rows Informational / Warning / Stop. `critical`
  is unreachable by construction, and the verbatim source status is what the interface shows.
- **No fabricated maintenance.** The dataset has no work orders, root causes or repair records, so
  none exist for these turbines and none is generated. Asked how a real event was resolved, the
  system states that verified resolution data is not present.
- **No invented turbines.** The published dataset has no WT03, so there is no `PEN-T03`. The
  synthetic farm's `WT-03` is fictional and unrelated.

`npm run demo:reset`, with or without `--include-imports`, cannot reach `public_data`.
