-- Additive migration for the read-only operational-event ingestion boundary.
--
-- Nothing is dropped, renamed or rewritten. Two nullable columns record where an event came from,
-- and a partial unique index makes replays of the same upstream event harmless.
--
-- Earlier migrations are never edited in place.
begin;

-- Which adapter delivered the event. Null for events created by hand or by a CSV import, so every
-- existing row keeps its exact current meaning.
alter table public.asset_events add column if not exists event_source text
  check (event_source is null or char_length(event_source) between 1 and 64);

-- The upstream system's own identifier for the event. Industrial feeds resend, so this is what
-- makes ingestion idempotent.
alter table public.asset_events add column if not exists external_event_id text
  check (external_event_id is null or char_length(external_event_id) between 1 and 200);

-- Idempotency, enforced by the database rather than by a read-then-write race in application code.
-- Partial, so the millions of rows with no external id are unaffected and unconstrained.
create unique index if not exists asset_events_external_identity_idx
  on public.asset_events (event_source, external_event_id)
  where event_source is not null and external_event_id is not null;

-- The simulator feed and the fleet dashboard both read recent events by source.
create index if not exists asset_events_source_recent_idx
  on public.asset_events (event_source, occurred_at desc)
  where event_source is not null;

commit;
