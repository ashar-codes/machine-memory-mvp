

## Real public data — 2026-09-10

Genuine Penmanshiel operational events are now imported: 1,172 rows for two turbines, February 2023,
from Zenodo record 16807304 (CC-BY-4.0). Verified live — the copilot summarizes real event history,
counts real recurrences in SQL, and combines real operational facts with public OSHA/NREL reference
evidence in a single answer with the two clearly separated by provenance.

Two accuracy defects surfaced from working with real data rather than synthetic: the deterministic
answer conflated "no resolution recorded" with "no records at all", and intent classification let a
passing mention of "maintenance" outrank an explicit request for technical references.

Still not imported: SCADA signal rows (42 MB per turbine-month, no retrieval benefit), and turbines
beyond PEN-T01/PEN-T02.
