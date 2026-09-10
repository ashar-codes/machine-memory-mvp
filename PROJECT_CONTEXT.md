

## SCADA simulator — 2026-09-10

A simulated operational-event feed and the read-only boundary it arrives through. Machine Memory
still has no live SCADA connection, and the interface says so on the page.

Verified live against Supabase: a `gearbox_temperature` run on WT-10 streamed normal → warning →
critical over SSE; the critical `GEAR-TMP-402` event persisted with `simulation` provenance, moved
WT-10 to `fault`, appeared in the timeline, fleet counts and recurring-fault list, and triggered an
automatic investigation returning HIGH strength with evidence spanning three provenance classes
(`public_reference`, `simulation`, `user_import`) and all citations resolving. Replaying the same
`externalEventId` returned the stored row rather than creating a second event.

Three defects were found by running it rather than by reading it: an unref'd timer that silently
stalled a scenario between steps, an unhandled `error` event on a checked-out pg client that
crashed the process on a dropped TLS socket, and `description` being NOT NULL while the normalized
contract makes it optional.
