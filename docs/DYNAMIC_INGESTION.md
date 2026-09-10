

## Real public operational data

A fifth way in, and the only one that is not user-supplied: `npm run data:penmanshiel -- --events`
imports genuine Penmanshiel status exports as `public_data`.

It reuses `asset_events`, the `(event_source, external_event_id)` idempotency index and the ordinary
retrieval path — no separate pipeline. Severity is mapped conservatively from the source's own
Informational/Warning/Stop classification and can never become `critical`, and the dataset's total
absence of work orders and root causes is preserved rather than filled in.

See `docs/PENMANSHIEL_DATA.md`.
