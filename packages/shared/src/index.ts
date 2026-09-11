// Contract v1. Architect-owned. Types/constants only; no runtime business logic.
export const INTENTS = ['HISTORY','PREVIOUS_RESOLUTION','SIMILAR_INCIDENTS','RECENT_CHANGES','TECHNICAL_GUIDANCE','GENERAL','SAFETY'] as const;
export type Intent = typeof INTENTS[number];
// v1.2 (additive): 'user_import' is data loaded through the Data Hub; 'simulation' is a fault
// injected in Scenario Lab. Neither is ever treated as reviewed public reference by retrieval.
export const RECORD_ORIGINS = ['public_data','public_reference','synthetic_demo','user_demo','user_import','simulation'] as const;
export type RecordOrigin = typeof RECORD_ORIGINS[number];
export type EvidenceStrength = 'HIGH' | 'MODERATE' | 'INSUFFICIENT';
export type SafetyStatus = 'NORMAL' | 'REFUSED' | 'INSUFFICIENT';
export type AuthorityClass = 'OEM' | 'REGULATOR' | 'RESEARCH' | 'HISTORICAL' | 'UNVERIFIED';
// v1.4 (additive): `siteName` lets the interface name the real site a turbine belongs to.
export interface Asset {id:string; siteId:string; siteName?:string; assetCode:string; assetType:string; manufacturer:string|null; model:string|null; serialNumber:string|null; status:string; metadata:Record<string,unknown>; recordOrigin:RecordOrigin; createdAt:string}
export interface AssetEvent {id:string; assetId:string; eventCode:string; title:string; subsystem:string|null; severity:string; occurredAt:string; clearedAt:string|null; description:string|null; recordOrigin:RecordOrigin}
export interface Incident {id:string; assetId:string; eventCode:string|null; symptoms:string; rootCause:string|null; resolutionSummary:string|null; openedAt:string; closedAt:string|null; recordOrigin:RecordOrigin}
export interface TimelineItem {id:string; kind:'EVENT'|'MAINTENANCE'|'NOTE'|'RESOLUTION'; title:string; description:string; timestamp:string; recordOrigin:RecordOrigin}
export interface Evidence {id:string; title:string; sourceType:string; authorityClass:string; excerpt:string; assetCode:string|null; timestamp:string|null; recordOrigin:RecordOrigin; sourceUrl:string|null}
export interface Answer {summary:string; findings:{title:string;detail:string;citationIds:string[]}[]; evidenceStrength:EvidenceStrength; uncertainties:string[]; safetyStatus:SafetyStatus}
// v1.5 (additive, loosening): `intent` is optional. Omit it for a free-text question and the
// backend routes it deterministically — a code named in the question outranks `eventCode`, and an
// asset-wide question is not narrowed to it. Supplying an intent (the preset probes) is unchanged.
export interface InvestigateRequest {assetCode:string; eventCode?:string; intent?:Intent; question:string}
export interface InvestigateResponse {answer:Answer; evidence:Evidence[]}
export interface ResolutionRequest {assetCode:string; eventCode:string; rootCause:string; resolutionSummary:string; component:string; downtimeMinutes:number; notes:string; validated:boolean}
export interface Resolution extends ResolutionRequest {id:string; assetId:string; recordOrigin:'user_demo'; createdAt:string}
export interface ResolutionResponse {resolution:Resolution; timelineRefresh:{assetCode:string;url:string}; memoryStatus:'STRUCTURED_SAVED_SEMANTIC_PENDING'}
// v1.1: `phase` gained the 'mvp' member so health cannot imply the pipeline is still unimplemented.
// Field names, other members and every other shape are unchanged. See docs/API_CONTRACT.md.
export interface HealthResponse {status:'ok'|'degraded'; service:'machine-memory'; database:'not_configured'|'connected'|'unavailable'; llm:'not_configured'|'configured_unverified'; phase:'foundation'|'mvp'}
export interface ErrorResponse {error:{code:string;message:string;requestId:string}}
export interface ListResponse<T> {items:T[];limit:number;offset:number;hasMore:boolean}
export interface AssetResponse {asset:Asset}
export interface CurrentEventResponse {event:AssetEvent|null}
export interface IngestRequest {manifestPath:string}
export interface IngestResponse {status:'disabled';message:string}

// ---- v1.2 dynamic Machine Memory. Additive: no existing shape above changed. ----
// Committable structured imports. SCADA is deliberately absent: see docs/DYNAMIC_INGESTION.md.
export const IMPORT_TYPES = ['EVENT_LOG','MAINTENANCE_HISTORY','WORK_ORDERS','TECHNICIAN_NOTES'] as const;
export type ImportType = typeof IMPORT_TYPES[number];
export type MappingStatus = 'HIGH_MATCH' | 'SUGGESTED' | 'NEEDS_REVIEW' | 'UNMAPPED';
export interface FieldSpec {field:string; label:string; required:boolean; description:string}
export interface ColumnMapping {column:string; field:string|null; status:MappingStatus; note:string}
export interface ImportPreview {
  dataSourceId:string; importType:ImportType; originalFilename:string;
  columns:string[]; sampleRows:Record<string,string>[]; totalRows:number; truncated:boolean;
  mapping:ColumnMapping[]; targetFields:FieldSpec[]; unmappedRequired:string[];
  mappingSource:'ai'|'heuristic'; notes:string[];
}
export interface ImportCommitRequest {dataSourceId:string; importType:ImportType; mapping:Record<string,string>; simulation?:boolean}
export interface ImportRejection {row:number; reason:string}
export interface ImportReport {
  batchId:string; importType:ImportType; rowsReceived:number; rowsImported:number; rowsRejected:number;
  rejections:ImportRejection[]; recordOrigin:RecordOrigin; assetsTouched:string[];
}
export interface KnowledgeSource {
  id:string; title:string; organization:string; sourceType:string; authorityClass:AuthorityClass;
  recordOrigin:RecordOrigin; sourceUrl:string|null; chunks:number; embeddedChunks:number;
  indexed:boolean; createdAt:string; assetType:string|null; manufacturer:string|null; model:string|null;
  deletable:boolean;
}
export interface KnowledgeChunkPreview {chunkIndex:number; section:string|null; pageNumber:number|null; excerpt:string; embedded:boolean}
export interface KnowledgeDetail {source:KnowledgeSource; chunkPreviews:KnowledgeChunkPreview[]}
export interface KnowledgeUploadReport {source:KnowledgeSource; chunksCreated:number; chunksEmbedded:number; message:string}
export interface CreateAssetRequest {assetCode:string; siteName:string; assetType?:string; manufacturer?:string; model?:string; serialNumber?:string; ratedPowerKw?:number; commissionedOn?:string; description?:string}
export interface CreateEventRequest {assetCode:string; eventCode:string; title:string; subsystem?:string; severity:string; occurredAt:string; description?:string; simulation:boolean}
export interface CopilotMessage {role:'user'|'assistant'; content:string}
export type CopilotScope = 'asset' | 'fleet';
export interface CopilotRequest {scope:CopilotScope; assetCode?:string; eventCode?:string; question:string; history?:CopilotMessage[]}
export interface FleetQueryPlan {operation:string; parameters:Record<string,unknown>; label:string}
export interface CopilotResponse {answer:Answer; evidence:Evidence[]; scope:CopilotScope; assetCode:string|null; plan:FleetQueryPlan|null; structuredFacts:Record<string,unknown>}
export interface RecurringFault {assetCode:string; eventCode:string; occurrences:number; firstAt:string; lastAt:string; openNow:boolean; recordOrigins:RecordOrigin[]}
export interface FleetSummary {
  totals:{assets:number; healthy:number; warning:number; faulted:number; other:number; openIncidents:number; recurringFaults:number; knowledgeSources:number; knowledgeChunks:number};
  recentMemory:{kind:string; title:string; detail:string; timestamp:string; recordOrigin:RecordOrigin; assetCode:string|null}[];
}

// ---- v1.3 read-only operational-event boundary. Additive; nothing above changed. ----
export const SCADA_SEVERITIES = ['info','warning','critical'] as const;
export type ScadaSeverity = typeof SCADA_SEVERITIES[number];
export interface ScadaSignal {label:string; value:number; unit:string}
/** Illustrative demonstration values. Not OEM thresholds, never embedded, never cited as evidence. */
export interface ScadaEventPayload {
  id:string; assetCode:string; eventCode:string; title:string; subsystem:string|null;
  severity:ScadaSeverity; occurredAt:string; description:string|null; recordOrigin:RecordOrigin;
  source:string; externalEventId:string; duplicate:boolean; signalSnapshot:ScadaSignal[];
}
export interface ScadaTelemetryPayload {
  runId:string; assetCode:string; title:string; severity:ScadaSeverity; occurredAt:string; signalSnapshot:ScadaSignal[];
}
export interface ScadaRunPayload {runId:string; scenarioId:string; assetCode:string; status:'started'|'finished'|'stopped'|'failed'; step?:number; total?:number}
export interface ScadaScenario {id:string; name:string; summary:string; steps:number; durationSeconds:number}
export interface ScadaStatus {connected:boolean; simulated:true; source:string; running:boolean; scenarios:ScadaScenario[]; recentEvents:ScadaEventPayload[]}
export interface StartSimulationRequest {scenarioId:string; assetCode:string; speed?:'1x'|'fast'}
export interface StartSimulationResponse {runId:string; scenarioId:string; assetCode:string; status:'started'}

// ---- v1.4 public operational-data summary. Additive; nothing above changed. ----
export interface EventCodeCount {eventCode:string; message:string|null; occurrences:number}
export interface SourceEventRow {
  id:string; occurredAt:string; clearedAt:string|null; eventCode:string; sourceCode:string|null;
  title:string; severity:string; sourceStatus:string|null; duration:string|null;
  iecCategory:string|null; recordOrigin:RecordOrigin;
}
/** Every field is computed from imported rows. Nothing here is estimated. */
export interface AssetEventSummary {
  assetCode:string; recordOrigin:RecordOrigin; source:string|null; sourceTurbine:string|null;
  totalEvents:number; distinctEventCodes:number;
  firstEventAt:string|null; lastEventAt:string|null;
  topEventCodes:EventCodeCount[];
  hasMaintenanceRecords:boolean;
  recentEvents:SourceEventRow[];
}

