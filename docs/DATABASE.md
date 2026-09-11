> Historical foundation design notes. Later live checks and outstanding gates are recorded in
> [REMEDIATION_STATUS.md](REMEDIATION_STATUS.md) and the [current checkpoint table](../PROJECT_CONTEXT.md).
> References below to unverified seed/schema work describe the original foundation stage.

# Database contract

The migration in `supabase/migrations/` defines the 12 tables requested by the brief in PostgreSQL `public`. UUID primary keys default to `gen_random_uuid()`. Dates are `timestamptz`; generated timestamps use `now()`. The migration and seed each run within a transaction. No live database has been changed.

| Table | Contract beyond common id, record_origin, created_at |
|---|---|
| sites | name, timezone (UTC default), metadata JSONB |
| assets | site_id, globally unique asset_code, asset_type, manufacturer, model, serial_number, status, metadata |
| components | asset_id, component_code, name, subsystem, installed_at, metadata |
| asset_events | asset_id, event_code, title, subsystem, severity, occurred_at, cleared_at, description, source_metadata |
| incidents | asset_id, event_code, symptoms, root_cause, resolution_summary, opened_at, closed_at |
| work_orders | asset_id, event_code, summary, root_cause, resolution, status, completed_at |
| maintenance_events | asset_id, component_id, event_type, description, occurred_at, work_order_id |
| technician_notes | asset_id, incident_id, content |
| documents | title, organization, source_url, source_type, authority_class, metadata |
| document_chunks | document_id, asset_id nullable, event_code nullable, chunk_index, content, embedding, page_number, section, metadata |
| investigations | asset_id, event_code, question, intent |
| resolutions | asset_id, event_code, root_cause, resolution_summary, component, downtime_minutes, notes, validated |

`record_origin` is a constrained text domain: public_data, public_reference, synthetic_demo, user_demo. It is mandatory everywhere; investigations default to user_demo. `validated` defaults to false and is a user-declared flag, not proof of engineering authorization.

Assets support operational, warning, fault, maintenance and offline states. Event severities are info, warning and critical. Work order states are open, completed and cancelled. A completed work order requires completed_at. Cleared/closed timestamps cannot precede occurrence/opening. Downtime is a nonnegative integer. Components, work orders and notes have composite foreign keys preventing cross-asset linkage. Deletes are restrictive except document deletion cascades to its chunks.

Public document origins require an HTTPS source URL. Synthetic/user documents may only claim HISTORICAL or UNVERIFIED authority. Authority classes are OEM, REGULATOR, RESEARCH, HISTORICAL and UNVERIFIED. Chunk provenance must equal its parent document. The database does not verify a URL's contents or a source's authority; ingestion must do that.

## Retrieval

Embedding storage is `extensions.vector(1536)`, matching gemini-embedding-001 requested at `outputDimensionality` 1536 and renormalized to unit length. Embeddings remain nullable until actual API ingestion succeeds; fake vectors are prohibited. Prefer explicit operators/casts with direct pg SQL:

```sql
select c.id, c.content, d.title,
       1 - (c.embedding operator(extensions.<=>) $1::extensions.vector) as similarity
from public.document_chunks c
join public.documents d on d.id = c.document_id
where c.embedding is not null
  and (c.asset_id = $2::uuid or c.asset_id is null)
  and (c.event_code = $3::text or c.event_code is null)
  and d.metadata->>'assetType' = $5::text
  and (d.metadata->>'manufacturer' is null or d.metadata->>'manufacturer' = $6::text)
  and (d.metadata->>'model' is null or d.metadata->>'model' = $7::text)
order by c.embedding operator(extensions.<=>) $1::extensions.vector
limit $4;
```

The bounded corpus uses exact vector search to preserve metadata-filter completeness. No HNSW index is needed yet. B-tree indexes cover asset history, current events, recurrence, timeline and foreign-key lookups. A GIN expression index supports `to_tsvector('english', content)` text search.

## Access boundary

Every table enables RLS. There are no browser policies, and all table privileges are revoked from PUBLIC, anon and authenticated. Backend pg uses a secret server connection; a migration-owner connection bypasses RLS, so backend authorization and parameterized SQL remain mandatory. There is no machinery-control interface. No definer functions, public RPCs or views are created. This is a dedicated-project migration: vector must exist in extensions or it aborts rather than relocating an existing project's extension.

## Deployment and verification status

The schema and seed are authored but **not applied or live verified**. No target database or credentials have been confirmed. Run the project's explicit migration and seed commands only against the intended dedicated project. After application verify all 12 tables have RLS, anon/authenticated cannot read or write, invalid cross-asset references fail, seed counts match SEED_CONTRACT.md, vector dimension is 1536, and a user resolution is visible in future SQL retrieval. Supabase advisors and these live checks remain pending.

References consulted: [Supabase pgvector](https://supabase.com/docs/guides/database/extensions/pgvector), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). The changelog Markdown endpoint could not be fetched in this environment.

Local static verification passed for the 12-table count, required provenance/timestamp fields, full RLS table list, absent public policies, 1536 vector dimension, same-asset foreign keys and seed transaction framing. This is not SQL execution verification. Supabase CLI installation was attempted twice and blocked by network approval cancellation; the migration file was authored directly as a documented environment fallback, not generated by the CLI. No local Docker dependency is introduced.

## Read-only verification queries after applying to the dedicated project

```sql
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' order by c.relname;

select table_name, grantee, privilege_type
from information_schema.table_privileges
where table_schema='public' and grantee in ('anon','authenticated','PUBLIC');
-- Expected: no table privileges for these principals.

select a.asset_code, e.event_code, count(*) as total,
       count(*) filter (where e.cleared_at is not null) as cleared,
       count(*) filter (where e.cleared_at is null) as current
from public.asset_events e join public.assets a on a.id=e.asset_id
group by a.asset_code,e.event_code order by a.asset_code,e.event_code;

select format_type(atttypid,atttypmod) as embedding_type
from pg_attribute where attrelid='public.document_chunks'::regclass
 and attname='embedding';
-- Expected vector(1536). Also run cross-asset failure/transaction tests and advisors.
```

The example vector SQL is a parameterized template, not a completed retrieval service. Parameters5–7 are selected asset type/manufacturer/model. Unspecified applicability is general evidence only, never verified model-specific procedure support.

## Verifying the completed pipeline

After applying the migration, seeding and importing, these checks confirm the parts the offline
tests cannot reach. Run them in the SQL editor of the dedicated project.

```sql
-- pgvector is present in the extensions schema and the column is 1536-dimensional
select extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where extname = 'vector';
select atttypmod from pg_attribute where attrelid = 'public.document_chunks'::regclass and attname = 'embedding';

-- the cosine operator resolves when schema-qualified, which is how retrieval.ts calls it
select 1 - ('[1,0,0]'::extensions.vector operator(extensions.<=>) '[1,0,0]'::extensions.vector) as cosine_similarity;

-- provenance separation: the fictional farm and the public farm are different sites
select s.name, a.record_origin, count(*) from public.assets a join public.sites s on s.id = a.site_id
group by 1, 2 order by 1;

-- WT-07 recurrence, the number the HISTORY intent reports
select count(*) filter (where cleared_at is not null) as previous, count(*) as total
from public.asset_events where event_code = 'PITCH-HYD-214'
  and asset_id = (select id from public.assets where asset_code = 'WT-07');

-- public turbines legitimately have no events; this must return zero rows, not fabricated ones
select a.asset_code, count(e.id) from public.assets a
left join public.asset_events e on e.asset_id = a.id
where a.record_origin = 'public_data' group by 1 having count(e.id) > 0;

-- corpus state: only claim the corpus is ingested if this returns embedded chunks
select d.title, d.authority_class, d.record_origin, count(c.id) as chunks,
       count(c.embedding) as embedded
from public.documents d left join public.document_chunks c on c.document_id = d.id
group by 1, 2, 3 order by 1;

-- browser access stays closed
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
select grantee, table_name, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');
```

The last query must return no rows. If it returns grants, the migration's revoke block did not run
and the browser role can reach maintenance data.

The `EXPLAIN` worth running once is the knowledge query: with a corpus this small an exact vector
scan is intended and correct. Do not add an HNSW index until a measurement shows it is needed;
an approximate index on a few dozen chunks trades recall for nothing.
