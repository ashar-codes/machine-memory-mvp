-- Entire dataset is fictional university demonstration data. Not Penmanshiel or Zephyr.
-- Stable UUIDs make repeat execution harmless; existing demo/user work is never overwritten.
begin;
insert into public.sites(id,name,timezone,metadata,record_origin) values
 ('10000000-0000-4000-8000-000000000001','Demonstration Wind Farm','UTC','{"fictional":true,"disclaimer":"Synthetic university demonstration; no operational plant data"}','synthetic_demo')
on conflict(id) do nothing;
insert into public.assets(id,site_id,asset_code,asset_type,manufacturer,model,status,metadata,record_origin) values
 ('20000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','WT-07','wind_turbine','Fictional Demo OEM','Demo 2MW','fault','{"rated_power_kw":2000,"fictional":true}','synthetic_demo'),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','WT-03','wind_turbine','Fictional Demo OEM','Demo 2MW','operational','{"rated_power_kw":2000,"fictional":true}','synthetic_demo'),
 ('20000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','WT-11','wind_turbine','Fictional Demo OEM','Demo 2MW','warning','{"rated_power_kw":2000,"fictional":true}','synthetic_demo')
on conflict(id) do nothing;
insert into public.components(id,asset_id,component_code,name,subsystem,installed_at,record_origin) values
 ('30000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000007','PITCH-HYD-A','Pitch hydraulic assembly','Pitch','2025-01-01T00:00:00Z','synthetic_demo') on conflict(id) do nothing;
insert into public.asset_events(id,asset_id,event_code,title,subsystem,severity,occurred_at,cleared_at,description,source_metadata,record_origin) values
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000007','PITCH-HYD-214','Pitch hydraulic pressure alert','Pitch','warning','2026-07-03T08:00:00Z','2026-07-03T09:10:00Z','Synthetic pressure alert used to demonstrate recurrence.','{"fictional_event_code":true}','synthetic_demo'),
 ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000007','PITCH-HYD-214','Pitch hydraulic pressure alert','Pitch','warning','2026-08-15T10:00:00Z','2026-08-15T10:47:00Z','Synthetic repeat alert after intermittent pressure indication.','{"fictional_event_code":true}','synthetic_demo'),
 ('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000007','PITCH-HYD-214','Pitch hydraulic pressure alert','Pitch','critical','2026-09-09T08:20:00Z',null,'Current synthetic alert; no approved troubleshooting procedure is attached.','{"fictional_event_code":true}','synthetic_demo'),
 ('40000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000003','PITCH-HYD-214','Pitch hydraulic pressure alert','Pitch','warning','2026-08-02T11:00:00Z','2026-08-02T12:00:00Z','Synthetic fleet comparison event.','{"fictional_event_code":true}','synthetic_demo'),
 ('40000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000011','GEN-TEMP-108','Generator temperature trend alert','Generator','warning','2026-09-08T14:00:00Z',null,'Unrelated synthetic generator event for metadata-filter demonstrations.','{"fictional_event_code":true}','synthetic_demo')
on conflict(id) do nothing;
insert into public.incidents(id,asset_id,event_code,symptoms,root_cause,resolution_summary,opened_at,closed_at,record_origin) values
 ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000007','PITCH-HYD-214','Intermittent pressure indication','Synthetic diagnosis: sensor connector deterioration','Historical demo account: connector replaced by authorized team. This is not an approved procedure.','2026-07-03T08:00:00Z','2026-07-03T09:10:00Z','synthetic_demo'),
 ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000007','PITCH-HYD-214','Repeated hydraulic pressure alert','Synthetic diagnosis: sensor drift','Historical demo account: pressure sensor replaced by authorized team. This is not an approved procedure.','2026-08-15T10:00:00Z','2026-08-15T10:47:00Z','synthetic_demo'),
 ('50000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','PITCH-HYD-214','Pressure indication intermittently unavailable','Synthetic diagnosis: wiring defect','Historical demo account: wiring defect corrected by authorized team. Not technical guidance.','2026-08-02T11:00:00Z','2026-08-02T12:00:00Z','synthetic_demo'),
 ('50000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000007','PITCH-HYD-214','Current hydraulic pressure alert',null,null,'2026-09-09T08:20:00Z',null,'synthetic_demo')
on conflict(id) do nothing;
insert into public.work_orders(id,asset_id,event_code,summary,root_cause,resolution,status,completed_at,record_origin) values
 ('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000007','PITCH-HYD-214','Synthetic pressure sensor replacement','Synthetic sensor drift','Sensor replaced; fictional historical account, not a procedure.','completed','2026-08-15T10:47:00Z','synthetic_demo') on conflict(id) do nothing;
insert into public.maintenance_events(id,asset_id,component_id,event_type,description,occurred_at,work_order_id,record_origin) values
 ('70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000007','component_replacement','Synthetic record: pressure sensor replacement on pitch hydraulic assembly.','2026-08-15T10:47:00Z','60000000-0000-4000-8000-000000000001','synthetic_demo'),
 ('70000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000007','inspection','Synthetic recent inspection note: no visible leak recorded. Does not establish equipment safety.','2026-09-07T09:00:00Z',null,'synthetic_demo') on conflict(id) do nothing;
insert into public.technician_notes(id,asset_id,incident_id,content,created_at,record_origin) values
 ('80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000007','50000000-0000-4000-8000-000000000002','Synthetic technician memory: indication stabilized after the historical sensor replacement. Causation and applicability to the current event are unverified.','2026-08-15T11:00:00Z','synthetic_demo') on conflict(id) do nothing;
insert into public.resolutions(id,asset_id,event_code,root_cause,resolution_summary,component,downtime_minutes,notes,validated,record_origin,created_at) values
 ('90000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000007','PITCH-HYD-214','Synthetic sensor drift','Historical sensor replacement recorded in demo work order.','Pressure sensor',47,'Fictional historical narrative; not an approved maintenance instruction.',false,'synthetic_demo','2026-08-15T11:00:00Z') on conflict(id) do nothing;
commit;
