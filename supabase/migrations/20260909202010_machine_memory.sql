-- Machine Memory foundation. Apply only to a dedicated Supabase project.
begin;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
-- Reject incompatible extension placement instead of silently assuming a search path.
do $$ begin
  if not exists (select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector' and n.nspname='extensions') then
    raise exception 'vector must be installed in extensions schema';
  end if;
end $$;
create domain public.record_origin as text
  check (value in ('public_data','public_reference','synthetic_demo','user_demo'));

create table public.sites (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name))>0),
 timezone text not null default 'UTC',
 metadata jsonb not null default '{}',
 record_origin public.record_origin not null,
 created_at timestamptz not null default now()
);
create table public.assets (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id),
 asset_code text not null unique check(length(trim(asset_code))>0),
 asset_type text not null,
 manufacturer text, model text, serial_number text,
 status text not null default 'operational' check(status in ('operational','warning','fault','maintenance','offline')),
 metadata jsonb not null default '{}',
 record_origin public.record_origin not null,
 created_at timestamptz not null default now()
);
create table public.components (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.assets(id),
 component_code text not null, name text not null, subsystem text,
 installed_at timestamptz, metadata jsonb not null default '{}',
 record_origin public.record_origin not null,
 created_at timestamptz not null default now(),
 unique(asset_id,component_code), unique(id,asset_id)
);
create table public.asset_events (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.assets(id),
 event_code text not null, title text not null, subsystem text,
 severity text not null check(severity in ('info','warning','critical')),
 occurred_at timestamptz not null, cleared_at timestamptz,
 description text not null default '', source_metadata jsonb not null default '{}',
 record_origin public.record_origin not null,
 created_at timestamptz not null default now(),
 check(cleared_at is null or cleared_at>=occurred_at)
);
create table public.incidents (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.assets(id),
 event_code text not null, symptoms text not null,
 root_cause text, resolution_summary text,
 opened_at timestamptz not null, closed_at timestamptz,
 record_origin public.record_origin not null,
 created_at timestamptz not null default now(),
 unique(id,asset_id), check(closed_at is null or closed_at>=opened_at)
);
create table public.work_orders (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.assets(id),
 event_code text, summary text not null,
 root_cause text, resolution text,
 status text not null default 'open' check(status in ('open','completed','cancelled')),
 completed_at timestamptz,
 record_origin public.record_origin not null,
 created_at timestamptz not null default now(),
 unique(id,asset_id), check(status<>'completed' or completed_at is not null)
);
create table public.maintenance_events (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.assets(id),
 component_id uuid, event_type text not null, description text not null,
 occurred_at timestamptz not null, work_order_id uuid,
 record_origin public.record_origin not null,
 created_at timestamptz not null default now(),
 foreign key(component_id,asset_id) references public.components(id,asset_id),
 foreign key(work_order_id,asset_id) references public.work_orders(id,asset_id)
);
create table public.technician_notes (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.assets(id),
 incident_id uuid, content text not null check(length(trim(content))>0),
 record_origin public.record_origin not null,
 created_at timestamptz not null default now(),
 foreign key(incident_id,asset_id) references public.incidents(id,asset_id)
);
create table public.documents (
 id uuid primary key default gen_random_uuid(),
 title text not null, organization text,
 source_url text check(source_url is null or source_url ~ '^https://'),
 source_type text not null check(source_type in ('TECHNICAL_REFERENCE','SAFETY_REFERENCE','TECHNICIAN_NOTE')),
 authority_class text not null check(authority_class in ('OEM','REGULATOR','RESEARCH','HISTORICAL','UNVERIFIED')),
 record_origin public.record_origin not null,
 metadata jsonb not null default '{}',
 created_at timestamptz not null default now(),
 unique(id,record_origin),
 check(record_origin not in ('public_data','public_reference') or source_url is not null),
 check(record_origin not in ('synthetic_demo','user_demo') or authority_class in ('HISTORICAL','UNVERIFIED'))
);
create table public.document_chunks (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null,
 asset_id uuid references public.assets(id), event_code text,
 chunk_index integer not null default 0 check(chunk_index>=0),
 content text not null check(length(trim(content))>0),
 embedding extensions.vector(1536),
 page_number integer check(page_number>0), section text,
 metadata jsonb not null default '{}',
 record_origin public.record_origin not null,
 created_at timestamptz not null default now(),
 unique(document_id,chunk_index),
 foreign key(document_id,record_origin) references public.documents(id,record_origin) on delete cascade
);
create table public.investigations (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.assets(id), event_code text,
 question text not null check(length(trim(question))>0),
 intent text not null check(intent in ('HISTORY','PREVIOUS_RESOLUTION','SIMILAR_INCIDENTS','RECENT_CHANGES','TECHNICAL_GUIDANCE','GENERAL','SAFETY')),
 record_origin public.record_origin not null default 'user_demo',
 created_at timestamptz not null default now()
);
create table public.resolutions (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.assets(id), event_code text not null,
 root_cause text not null check(length(trim(root_cause))>0),
 resolution_summary text not null check(length(trim(resolution_summary))>0),
 component text not null default '',
 downtime_minutes integer not null check(downtime_minutes>=0),
 notes text not null default '', validated boolean not null default false,
 record_origin public.record_origin not null,
 created_at timestamptz not null default now()
);

create index assets_site_idx on public.assets(site_id);
create index asset_events_history_idx on public.asset_events(asset_id,event_code,occurred_at desc);
create index asset_events_timeline_idx on public.asset_events(asset_id,occurred_at desc);
create index asset_events_fleet_idx on public.asset_events(event_code,occurred_at desc);
create index asset_events_current_idx on public.asset_events(asset_id,occurred_at desc) where cleared_at is null;
create index incidents_history_idx on public.incidents(asset_id,event_code,opened_at desc);
create index incidents_fleet_idx on public.incidents(event_code,opened_at desc);
create index work_orders_asset_idx on public.work_orders(asset_id,completed_at desc);
create index maintenance_timeline_idx on public.maintenance_events(asset_id,occurred_at desc);
create index maintenance_component_idx on public.maintenance_events(component_id,asset_id);
create index maintenance_work_order_idx on public.maintenance_events(work_order_id,asset_id);
create index technician_notes_asset_idx on public.technician_notes(asset_id,created_at desc);
create index technician_notes_incident_idx on public.technician_notes(incident_id,asset_id);
create index document_chunks_asset_event_idx on public.document_chunks(asset_id,event_code);
create index document_chunks_search_idx on public.document_chunks using gin(to_tsvector('english',content));
-- Exact vector scan is deliberate for the bounded MVP corpus. Add HNSW only after measuring.
create index investigations_asset_idx on public.investigations(asset_id,created_at desc);
create index resolutions_history_idx on public.resolutions(asset_id,event_code,created_at desc);
create index resolutions_timeline_idx on public.resolutions(asset_id,created_at desc);

-- No browser-facing policies. The server uses a secret database connection.
do $$ declare table_name text; begin
 foreach table_name in array array['sites','assets','components','asset_events','incidents','work_orders','maintenance_events','technician_notes','documents','document_chunks','investigations','resolutions'] loop
   execute format('alter table public.%I enable row level security',table_name);
   execute format('revoke all on table public.%I from public, anon, authenticated',table_name);
 end loop;
end $$;
commit;
