import type { ReactNode } from 'react';
import type { Evidence, EvidenceStrength, RecordOrigin } from '@machine-memory/shared';

const ORIGIN_LABEL: Record<RecordOrigin, string> = {
  public_data: 'Public data',
  public_reference: 'Public reference',
  synthetic_demo: 'Synthetic demo',
  user_demo: 'User demo',
  user_import: 'User import',
  simulation: 'Simulation',
};

/** Provenance is shown on every record. A technician must never have to guess where a fact came from. */
export function Origin({ value }: { value: RecordOrigin }) {
  return <span className={`origin ${value}`}>{ORIGIN_LABEL[value] ?? 'Unknown provenance'}</span>;
}

/**
 * Authority is a different axis from provenance and is drawn differently: an outline rather than a
 * tint, so the two are never read as the same fact. An unverified source is visibly distinct from a
 * reviewed one without being styled as an error.
 */
export function Authority({ value }: { value: string }) {
  return <span className={`authority ${value.toLowerCase()}`}>{value}</span>;
}

export function Severity({ value }: { value: string }) {
  const level = ['critical', 'warning', 'info'].includes(value) ? value : 'info';
  return <span className={`severity ${level}`}>{value}</span>;
}

export const STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  HIGH: 'Strong evidence',
  MODERATE: 'Moderate evidence',
  INSUFFICIENT: 'Insufficient evidence',
};

/** Evidence strength reads as a measured scale of three, not as a large coloured badge. */
export function Strength({ value }: { value: EvidenceStrength }) {
  return (
    <span className={`strength ${value.toLowerCase()}`}>
      <span className="strength-marks" aria-hidden="true"><i /><i /><i /></span>
      {STRENGTH_LABEL[value]}
    </span>
  );
}

export function stamp(value: string | null | undefined): string {
  if (!value) return 'No timestamp';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return 'No timestamp';
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Historical, technical and safety evidence are visually distinct because they are used differently. */
export function evidenceClass(item: Evidence): 'safety' | 'technical' | 'historical' {
  if (item.sourceType === 'SAFETY_REFERENCE') return 'safety';
  if (item.sourceType === 'TECHNICAL_REFERENCE') return 'technical';
  return 'historical';
}

export function Loading({ label }: { label: string }) {
  return <div className="loading" role="status"><span className="working">{label}</span></div>;
}

export function Failure({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <div className="failure" role="alert">
      <h3>{title}</h3>
      <p>{detail}</p>
      {onRetry && <button type="button" className="btn" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><h3>{title}</h3><p>{children}</p></div>;
}
