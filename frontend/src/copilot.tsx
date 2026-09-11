import { useEffect, useRef, useState } from 'react';
import type { CopilotMessage, CopilotResponse, Evidence } from '@machine-memory/shared';
import { failureText, post } from './api';
import { Empty, Strength } from './ui';

const ASSET_PROMPTS = [
  'Why could this fault be recurring?',
  'Summarize this turbine’s last 90 days.',
  'What changed before this fault?',
  'How was it solved previously?',
  'What technical evidence applies?',
];
const FLEET_PROMPTS = [
  'Which turbines have recurring faults?',
  'Which assets have unresolved incidents?',
  'What faults appeared most often this year?',
  'Which machines had faults shortly after maintenance?',
];

interface Turn { question: string; response: CopilotResponse | null; error: string }

/**
 * An investigation transcript, not a chat window. The question reads conversationally; the answer
 * renders as the same structured, cited assessment the workspace shows.
 */
export function CopilotView({ assetCode, eventCode, onEvidence }: {
  assetCode: string | null;
  eventCode: string | null;
  onEvidence: (evidence: Evidence[]) => void;
}) {
  const [scope, setScope] = useState<'asset' | 'fleet'>(assetCode ? 'asset' : 'fleet');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => { activeRequest.current?.abort(); }, []);

  const chooseScope = (next: 'asset' | 'fleet') => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setScope(next);
    setTurns([]);
    setDraft('');
    setRunning(false);
    onEvidence([]);
  };

  const effectiveScope = scope === 'asset' && !assetCode ? 'fleet' : scope;

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setDraft('');
    setRunning(true);
    onEvidence([]);
    const index = turns.length;
    setTurns((current) => [...current, { question: trimmed, response: null, error: '' }]);
    // Only completed turns become history, and the backend trims it again to a bounded window.
    const history: CopilotMessage[] = turns.flatMap((turn) => turn.response
      ? [{ role: 'user' as const, content: turn.question }, { role: 'assistant' as const, content: turn.response.answer.summary }]
      : []);
    try {
      const response = await post<CopilotResponse>('/copilot', {
        scope: effectiveScope,
        ...(effectiveScope === 'asset' ? { assetCode, ...(eventCode ? { eventCode } : {}) } : {}),
        question: trimmed,
        ...(history.length ? { history: history.slice(-6) } : {}),
      }, controller.signal);
      if (controller.signal.aborted) return;
      setTurns((current) => current.map((turn, position) => position === index ? { ...turn, response } : turn));
      onEvidence(response.evidence);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const text = failureText(cause) || 'The copilot request could not be completed.';
      setTurns((current) => current.map((turn, position) => position === index ? { ...turn, error: text } : turn));
    } finally {
      if (!controller.signal.aborted) {
        activeRequest.current = null;
        setRunning(false);
        requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
      }
    }
  };

  const prompts = effectiveScope === 'asset' ? ASSET_PROMPTS : FLEET_PROMPTS;

  return (
    <div className="page copilot">
      <div className="page-head">
        <span className="eyebrow">Engineering investigation</span>
        <h2>AI Copilot</h2>
        <p>
          The copilot answers from retrieved records only. Counts and dates are computed in SQL, every
          finding cites evidence, and safety refusals are decided before the model is called.
        </p>
      </div>

      <div className="scope-switch" role="group" aria-label="Copilot scope">
        <button type="button" className={`scope ${effectiveScope === 'asset' ? 'active' : ''}`}
          disabled={!assetCode} onClick={() => chooseScope('asset')}
          title={assetCode ? undefined : 'Select a turbine in Machine Memory to use asset scope.'}>
          Asset{assetCode ? ` · ${assetCode}` : ''}
        </button>
        <button type="button" className={`scope ${effectiveScope === 'fleet' ? 'active' : ''}`} onClick={() => chooseScope('fleet')}>
          Fleet
        </button>
      </div>

      <div className="transcript">
        {turns.length === 0 && (
          <Empty title={effectiveScope === 'asset' ? `Ask about ${assetCode}` : 'Ask about the fleet'}>
            {effectiveScope === 'asset'
              ? 'The copilot already knows this turbine, its current event and its recorded history. Ask in your own words.'
              : 'Fleet questions are answered by counting recorded rows. The model chooses which predefined query runs; it never writes SQL.'}
          </Empty>
        )}
        {turns.map((turn, index) => (
          <div className="turn" key={index}>
            <div className="asked">
              <span className="q-mark">Query</span>
              <p className="q-text">{turn.question}</p>
            </div>
            {turn.error && <p className="turn-error">{turn.error}</p>}
            {!turn.response && !turn.error && <p className="thinking">Retrieving evidence and composing a grounded answer…</p>}
            {turn.response && <CopilotAnswer response={turn.response} />}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="prompt-block">
        <span className="prompt-label">Common lines of enquiry</span>
        <div className="prompt-row">
          {prompts.map((prompt) => (
            <button key={prompt} type="button" className="probe" disabled={running} onClick={() => void ask(prompt)}>{prompt}</button>
          ))}
        </div>
      </div>

      <div className="ask">
        <span className="ask-field">
          <label className="ask-label" htmlFor="copilot-question">Your question</label>
          <input
            id="copilot-question"
            type="text"
            aria-label="Ask the copilot"
            value={draft}
            maxLength={2000}
            disabled={running}
            placeholder={effectiveScope === 'asset' ? `Ask about ${assetCode ?? 'this turbine'}…` : 'Ask about the fleet…'}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void ask(draft); }}
          />
        </span>
        <button type="button" className="btn primary" disabled={running || !draft.trim()} onClick={() => void ask(draft)}>Ask</button>
      </div>
    </div>
  );
}

function CopilotAnswer({ response }: { response: CopilotResponse }) {
  const { answer, plan, evidence } = response;
  const refused = answer.safetyStatus === 'REFUSED';
  return (
    <article className={`assessment ${refused ? 'refused' : ''}`}>
      <header>
        <span className="assessment-title">Assessment</span>
        <Strength value={answer.evidenceStrength} />
        {refused && <span className="verdict REFUSED">Refused</span>}
        {answer.safetyStatus === 'INSUFFICIENT' && <span className="verdict INSUFFICIENT">Insufficient</span>}
      </header>

      {refused && (
        <p className="safety-notice">
          This request asks to defeat a protection or operate unsafe equipment. Machine Memory does not
          answer it, whatever the conversation asked before.
        </p>
      )}

      <p className="assessment-summary">{answer.summary}</p>

      {plan && (
        <p className="plan-note">
          Ran the predefined query <code>{plan.operation}</code> — {plan.label}. The model chose the
          operation and parameters from a fixed list; the query itself is backend code.
        </p>
      )}

      {answer.findings.length > 0 && (
        <ul className="findings">
          {answer.findings.map((finding, index) => (
            <li key={index}>
              <span className="f-title">{finding.title}</span>
              <p>{finding.detail}</p>
              {finding.citationIds.length > 0 && (
                <span className="cites">
                  <span className="cites-label">Cites</span>
                  {finding.citationIds.map((id) => <code key={id}>{id}</code>)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {answer.uncertainties.length > 0 && (
        <div className="uncertainties">
          <span>Uncertainties</span>
          <ul>{answer.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      )}

      {evidence.length > 0 && (
        <p className="evidence-note">{evidence.length} evidence record{evidence.length === 1 ? '' : 's'} shown in the evidence panel.</p>
      )}
    </article>
  );
}
