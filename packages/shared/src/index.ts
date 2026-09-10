// Contract v1. Architect-owned. Types/constants only; no runtime business logic.
export const INTENTS = ['HISTORY','PREVIOUS_RESOLUTION','SIMILAR_INCIDENTS','RECENT_CHANGES','TECHNICAL_GUIDANCE','GENERAL','SAFETY'] as const;
export type Intent = typeof INTENTS[number];
export const RECORD_ORIGINS = ['public_data','public_reference','synthetic_demo','user_demo'] as const;
export type RecordOrigin = typeof RECORD_ORIGINS[number];
export type EvidenceStrength = 'HIGH' | 'MODERATE' | 'INSUFFICIENT';
export type SafetyStatus = 'NORMAL' | 'REFUSED' | 'INSUFFICIENT';
export type AuthorityClass = 'OEM' | 'REGULATOR' | 'RESEARCH' | 'HISTORICAL' | 'UNVERIFIED';
export interface Asset {id:string; siteId:string; assetCode:string; assetType:string; manufacturer:string|null; model:string|null; serialNumber:string|null; status:string; metadata:Record<string,unknown>; recordOrigin:RecordOrigin; createdAt:string}
export interface AssetEvent {id:string; assetId:string; eventCode:string; title:string; subsystem:string|null; severity:string; occurredAt:string; clearedAt:string|null; description:string|null; recordOrigin:RecordOrigin}
export interface Incident {id:string; assetId:string; eventCode:string|null; symptoms:string; rootCause:string|null; resolutionSummary:string|null; openedAt:string; closedAt:string|null; recordOrigin:RecordOrigin}
export interface TimelineItem {id:string; kind:'EVENT'|'MAINTENANCE'|'NOTE'|'RESOLUTION'; title:string; description:string; timestamp:string; recordOrigin:RecordOrigin}
export interface Evidence {id:string; title:string; sourceType:string; authorityClass:string; excerpt:string; assetCode:string|null; timestamp:string|null; recordOrigin:RecordOrigin; sourceUrl:string|null}
export interface Answer {summary:string; findings:{title:string;detail:string;citationIds:string[]}[]; evidenceStrength:EvidenceStrength; uncertainties:string[]; safetyStatus:SafetyStatus}
export interface InvestigateRequest {assetCode:string; eventCode?:string; intent:Intent; question:string}
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
