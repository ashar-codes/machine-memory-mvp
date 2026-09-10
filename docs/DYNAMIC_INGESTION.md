

## Operational events

A fourth way in, alongside manual entry, CSV import and document upload: a normalized read-only
event boundary. Machine Memory has no live SCADA connection; a simulator ships in its place.

Events arrive through `recordEvent()` — the same function manual entry uses — carry
`record_origin = 'simulation'`, and are deduplicated by `(source, externalEventId)`. Signal
snapshots shown beside an alarm are display-only and never become evidence.

See `docs/SCADA_INTEGRATION.md`.
