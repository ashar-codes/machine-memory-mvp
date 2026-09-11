import { useState } from 'react';
import type { Answer, Intent, ResolutionRequest } from '@machine-memory/shared';
import { Failure, Strength } from './ui';

export interface Probe { id: string; intent: Intent; label: string; question: string }

/** The five demonstration probes, plus safety, matching the frozen intent list. */
export const PROBES: Probe[] = [
  { id: 'history', intent: 'HISTORY', label: 'Has this happened before?', question: 'Has this happened before on this turbine?' },
  { id: 'previous', intent: 'PREVIOUS_RESOLUTION', label: 'How was it solved previously?', question: 'How was this fault resolved previously on this turbine?' },
  { id: 'fleet', intent: 'SIMILAR_INCIDENTS', label: 'Find similar fleet cases', question: 'Have other turbines recorded this event code or a similar fault?' },
  { id: 'changes', intent: 'RECENT_CHANGES', label: 'What changed recently?', question: 'What maintenance or component changes were recorded before this event?' },
  { id: 'technical', intent: 'TECHNICAL_GUIDANCE', label: 'Show technical guidance', question: 'What reviewed technical reference material applies to this subsystem?' },
];

export function InvestigationPanel({ activeProbe, running, disabled, canLogResolution, onRun, onLogResolution }: {
  activeProbe: string | null;
  running: boolean;
  disabled: boolean;
  canLogResolution: boolean;
  /** A null intent means free text: the backend routes the question itself. */
  onRun: (intent: Intent | null, question: string, probeId: string | null) => void;
  onLogResolution: () => void;
}) {
  const [custom, setCustom] = useState('');

  const submitCustom = () => {
    const question = custom.trim();
    if (!question || running || disabled) return;
    // A typed question carries no intent. Forcing one here also forced the selected event into
    // the request, so a question that named another event code was answered about the selected
    // one; the backend routes free text and decides both. Safety is re-checked there regardless.
    onRun(null, question, null);
  };

  return (
    <section className="investigate">
      <div className="section-bar">
        <h2>Investigate this asset</h2>
        <button
          type="button"
          className="btn"
          onClick={onLogResolution}
          disabled={disabled || !canLogResolution}
          title={canLogResolution ? undefined : 'A resolution is logged against an event code; this asset has no open event.'}
        >
          Log resolution
        </button>
      </div>

      <div className="probe-grid">
        {PROBES.map((probe) => (
          <button
            key={probe.id}
            type="button"
            className="probe"
            aria-pressed={activeProbe === probe.id}
            disabled={running || disabled}
            onClick={() => onRun(probe.intent, probe.question, probe.id)}
          >
            {probe.label}
          </button>
        ))}
      </div>

      <div className="ask">
        <span className="ask-field">
          <label className="ask-label" htmlFor="asset-question">Or ask in your own words</label>
          <input
            id="asset-question"
            type="text"
            aria-label="Ask a question about this asset"
            value={custom}
            maxLength={2000}
            placeholder="Ask about this turbine's history, changes or references"
            disabled={running || disabled}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') submitCustom(); }}
          />
        </span>
        <button type="button" className="btn primary" disabled={running || disabled || !custom.trim()} onClick={submitCustom}>
          Investigate
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ answer */

export function AnswerCard({ answer, running, error, onRetry, onCite }: {
  answer: Answer | null;
  running: boolean;
  error: string;
  onRetry: () => void;
  onCite: (id: string) => void;
}) {
  if (running) {
    return (
      <div className="answer">
        <div className="answer-shell">
          <div className="answer-body">
            <span className="working">Retrieving evidence and composing a grounded answer</span>
          </div>
        </div>
      </div>
    );
  }
  if (error) return <div className="answer"><Failure title="Investigation failed" detail={error} onRetry={onRetry} /></div>;
  if (!answer) return null;

  return (
    <article className="answer">
      <div className="answer-shell">
        <div className="answer-head">
          <h3>Investigation result</h3>
          <Strength value={answer.evidenceStrength} />
          <span className={`verdict ${answer.safetyStatus}`}>
            {answer.safetyStatus === 'NORMAL' ? 'Answered' : answer.safetyStatus}
          </span>
        </div>
        <div className="answer-body">
          <p className={`summary${answer.safetyStatus === 'REFUSED' ? ' refused' : ''}`}>{answer.summary}</p>

          {answer.findings.length > 0 && (
            <>
              <h4 className="findings-head">Findings</h4>
              <ol className="findings">
                {answer.findings.map((finding, index) => (
                  <li key={`${finding.title}-${index}`}>
                    <span className="f-title">{finding.title}</span>
                    <p>{finding.detail}</p>
                    {finding.citationIds.length > 0 && (
                      <div className="cites">
                        <span className="cites-label">Cites</span>
                        {finding.citationIds.map((id) => (
                          <button type="button" className="cite" key={id} onClick={() => onCite(id)}>{id}</button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}

          {answer.uncertainties.length > 0 && (
            <div className="uncertain">
              <h4>What this answer does not establish</h4>
              <ul>
                {answer.uncertainties.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- resolution */

const BLANK = { rootCause: '', resolutionSummary: '', component: '', downtimeMinutes: '0', notes: '', validated: false };

export function ResolutionDrawer({ assetCode, eventCode, onClose, onSave }: {
  assetCode: string;
  eventCode: string;
  onClose: () => void;
  onSave: (payload: ResolutionRequest) => Promise<void>;
}) {
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof typeof BLANK>(key: K, value: (typeof BLANK)[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const downtime = Number(form.downtimeMinutes);
  const ready = form.rootCause.trim() && form.resolutionSummary.trim() && form.component.trim()
    && Number.isInteger(downtime) && downtime >= 0 && downtime <= 525600;

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave({
        assetCode, eventCode,
        rootCause: form.rootCause.trim(),
        resolutionSummary: form.resolutionSummary.trim(),
        component: form.component.trim(),
        downtimeMinutes: downtime,
        notes: form.notes.trim(),
        validated: form.validated,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The resolution was not saved. Retry.');
      setSaving(false);
    }
  };

  return (
    <div
      className="scrim"
      role="dialog"
      aria-modal="true"
      aria-label={`Log a resolution for ${assetCode}`}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
    >
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <h2>Log resolution</h2>
            <p className="drawer-sub">
              <code>{assetCode}</code>
              <span aria-hidden="true">·</span>
              <code>{eventCode}</code>
              <span aria-hidden="true">·</span>
              saved as user demo data
            </p>
          </div>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>

        <p className="drawer-intro">
          A structured maintenance outcome added to this asset's machine memory. It becomes
          retrievable immediately and is cited with its provenance wherever it is used.
        </p>

        <div className="drawer-body">
          <div className="field">
            <label htmlFor="rootCause">Root cause</label>
            <textarea id="rootCause" maxLength={4000} value={form.rootCause}
              onChange={(event) => set('rootCause', event.target.value)} />
            <p className="help">What you determined was wrong. Recorded as your account, not as a verified diagnosis.</p>
          </div>

          <div className="field">
            <label htmlFor="resolutionSummary">Resolution</label>
            <textarea id="resolutionSummary" maxLength={4000} value={form.resolutionSummary}
              onChange={(event) => set('resolutionSummary', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="component">Component</label>
            <input id="component" type="text" maxLength={200} value={form.component}
              onChange={(event) => set('component', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="downtime">Downtime (minutes)</label>
            <input id="downtime" type="number" min={0} max={525600} step={1} value={form.downtimeMinutes}
              onChange={(event) => set('downtimeMinutes', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" maxLength={4000} value={form.notes}
              onChange={(event) => set('notes', event.target.value)} />
          </div>

          <div className="field check">
            <input id="validated" type="checkbox" checked={form.validated}
              onChange={(event) => set('validated', event.target.checked)} />
            <label htmlFor="validated">
              <strong>I confirm this outcome was observed.</strong>
              <br />
              This records your assertion only. It grants no engineering authority and does not make the
              record an approved procedure.
            </label>
          </div>
        </div>

        <div className="drawer-foot">
          <span className={`msg${error ? ' bad' : ''}`}>{error || (saving ? 'Saving…' : '')}</span>
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={!ready || saving}>
            Save to machine memory
          </button>
        </div>
      </div>
    </div>
  );
}
