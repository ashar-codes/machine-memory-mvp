

## Simulated operational events (v2.2)

The SCADA simulator produces events with `record_origin = 'simulation'` — the origin already used
for Scenario Lab injections. Nothing about them is real: the codes are fictional demonstration
codes, and the signal values shown beside them are illustrative, not OEM thresholds.

Signal snapshots are display-only. They are never stored as evidence, never embedded and never
cited, so no number from the simulator can ever appear as a retrieved fact.

`npm run demo:reset` clears simulated events along with user-entered resolutions, because both are
presentation residue. Data Hub imports stay behind `--include-imports`; the public and synthetic
corpora are never reachable by either.
