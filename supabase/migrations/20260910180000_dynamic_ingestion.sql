-- Additive migration for dynamic Machine Memory ingestion.
--
-- Nothing here drops, renames or rewrites an existing table, column or row. It widens the
-- record_origin domain with two new provenance classes and adds two bookkeeping tables so every
-- imported row can be traced back to the file a user uploaded.
--
-- The foundation migration 20260909202010_machine_memory.sql is never edited in place.
begin;

-- 'user_import' is data a user loaded through the Data Hub. 'simulation' is a fault deliberately
-- injected in Scenario Lab. Both are additions: existing values keep their exact meaning, and
-- neither is ever treated as a reviewed public reference by retrieval.
alter domain public.record_origin drop constraint record_origin_check;
alter domain public.record_origin add constraint record_origin_check
  check (value in ('public_data','public_reference','synthetic_demo','user_demo','user_import','simulation'));

-- A user import cannot claim regulator or research standing: only the reviewed public corpus may
-- act as procedural authority, and this keeps that true at the database level as well as in code.
alter table public.documents add constraint documents_user_import_authority_check
  check (record_origin <> 'user_import' or authority_class in ('OEM','HISTORICAL','UNVERIFIED'));

-- One row per uploaded file.
create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 400),
  source_type text not null check (source_type in (
    'EVENT_LOG','MAINTENANCE_HISTORY','WORK_ORDERS','TECHNICIAN_NOTES','ASSET_REGISTER',
    'TECHNICAL_DOCUMENT','SAFETY_PROCEDURE','SCADA_SAMPLE')),
  -- Stored for display and provenance only. It is never used to build a filesystem path.
  original_filename text not null check (char_length(original_filename) between 1 and 300),
  content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint check (byte_size >= 0),
  record_origin public.record_origin not null,
  status text not null default 'received' check (status in ('received','mapped','imported','indexed','failed')),
  metadata jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz not null default now()
);

-- One row per commit attempt against a data source.
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  data_source_id uuid not null references public.data_sources(id) on delete cascade,
  import_type text not null check (import_type in (
    'EVENT_LOG','MAINTENANCE_HISTORY','WORK_ORDERS','TECHNICIAN_NOTES','ASSET_REGISTER',
    'TECHNICAL_DOCUMENT','SAFETY_PROCEDURE','SCADA_SAMPLE')),
  rows_received integer not null default 0 check (rows_received >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  rows_rejected integer not null default 0 check (rows_rejected >= 0),
  -- The confirmed column mapping, kept so an import can be explained after the fact.
  mapping_json jsonb not null default '{}'::jsonb,
  -- Bounded sample of rejected rows and reasons. Never the whole file.
  rejection_sample jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','committed','failed')),
  created_at timestamptz not null default now()
);

-- Links an imported row back to the batch that produced it, without touching existing columns.
alter table public.asset_events add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.maintenance_events add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.work_orders add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.technician_notes add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.documents add column if not exists data_source_id uuid references public.data_sources(id) on delete set null;

create index data_sources_recent_idx on public.data_sources(uploaded_at desc, id);
create index import_batches_source_idx on public.import_batches(data_source_id, created_at desc);
create index asset_events_code_recurrence_idx on public.asset_events(event_code, asset_id, occurred_at desc);
create index documents_origin_idx on public.documents(record_origin, created_at desc);

-- Same posture as the foundation tables: no browser-facing policies, no anon/authenticated grants.
do $$ declare table_name text; begin
 foreach table_name in array array['data_sources','import_batches'] loop
   execute format('alter table public.%I enable row level security', table_name);
   execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
 end loop;
end $$;

commit;
