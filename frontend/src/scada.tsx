import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Answer, Asset, Evidence, ScadaEventPayload, ScadaStatus, ScadaTelemetryPayload,
  StartSimulationResponse,
} from '@machine-memory/shared';
import { failureText, get, post } from './api';
import { Authority, Empty, Failure, Loading, Origin, Severity, Strength } from './ui';

interface FeedRow {
  key: string;
  kind: 'telemetry' | 'event';
  time: string;
  assetCode: string;
  eventCode: string | null;
  subsystem: string | null;
  severity: string;
  title: string;
  duplicate?: boolean;
  signalSnapshot: { label: string; value: number; unit: string }[];
}

const clock = (iso: string) => new Date(iso).toISOString().slice(11, 19);

/**
 * An operational event feed, not a control room. Nothing here can send anything to a turbine:
 * the page starts a simulated feed and watches events arrive.
 */
export function ScadaSimulator({ assets, onFault, onInvestigate }: {
  assets: Asset[];
  onFault: (assetCode: string) => void;
  onInvestigate: (assetCode: string, eventCode: string) => void;
}) {
  const [status, setStatus] = useState<ScadaStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [streamLive, setStreamLive] = useState(false);
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [running, setRunning] = useState(false);
  const [assetCode, setAssetCode] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [speed, setSpeed] = useState<'1x' | 'fast'>('1x');
  const [latestFault, setLatestFault] = useState<ScadaEventPayload | null>(null);
  const [investigation, setInvestigation] = useState<{ answer: Answer; evidence: Evidence[] } | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    get<ScadaStatus>('/scada/status', controller.signal)
      .then((body) => {
        setStatus(body);
        setScenarioId((current) => current || body.scenarios[0]?.id || '');
        setRunning(body.running);
      })
      .catch((cause: unknown) => { const text = failureText(cause); if (text) setError(text); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!assetCode && assets.length) setAssetCode(assets[0].assetCode);
  }, [assets, assetCode]);

  const push = useCallback((row: FeedRow) => {
    // Newest first, and bounded: a long demonstration must not grow the DOM without limit.
    setRows((current) => [row, ...current].slice(0, 60));
    requestAnimationFrame(() => feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' }));
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/scada/stream');
    source.onopen = () => setStreamLive(true);
    source.onerror = () => setStreamLive(false);

    source.addEventListener('telemetry', (message) => {
      const row = JSON.parse((message as MessageEvent<string>).data) as ScadaTelemetryPayload;
      push({
        key: `t-${row.occurredAt}-${Math.random()}`, kind: 'telemetry', time: clock(row.occurredAt),
        assetCode: row.assetCode, eventCode: null, subsystem: null, severity: 'normal',
        title: row.title, signalSnapshot: row.signalSnapshot,
      });
    });

    source.addEventListener('event', (message) => {
      const payload = JSON.parse((message as MessageEvent<string>).data) as ScadaEventPayload & {
        investigation?: { answer: Answer; evidence: Evidence[] };
      };
      // The automatic investigation arrives as a follow-up on the same event id.
      if (payload.investigation) {
        setInvestigation(payload.investigation);
        setInvestigating(false);
        return;
      }
      push({
        key: `e-${payload.id}`, kind: 'event', time: clock(payload.occurredAt),
        assetCode: payload.assetCode, eventCode: payload.eventCode, subsystem: payload.subsystem,
        severity: payload.severity, title: payload.title, duplicate: payload.duplicate,
        signalSnapshot: payload.signalSnapshot,
      });
      if (payload.severity === 'critical' && !payload.duplicate) {
        setLatestFault(payload);
        setInvestigation(null);
        setInvestigating(true);
        onFault(payload.assetCode);
      }
    });

    source.addEventListener('run', (message) => {
      const run = JSON.parse((message as MessageEvent<string>).data) as { status: string };
      if (run.status === 'started') setRunning(true);
      if (['finished', 'stopped', 'failed'].includes(run.status)) setRunning(false);
    });

    return () => source.close();
  }, [push, onFault]);

  const start = async () => {
    if (!assetCode || !scenarioId) return;
    setError(''); setRows([]); setLatestFault(null); setInvestigation(null);
    try {
      await post<StartSimulationResponse>('/scada/simulate', { scenarioId, assetCode, speed });
      setRunning(true);
    } catch (cause) {
      setError(failureText(cause) || 'The simulation could not be started.');
    }
  };

  const stop = async () => {
    try { await post('/scada/simulation/stop', {}); } catch { /* the feed reports the real state */ }
    setRunning(false);
  };

  if (loading) return <div className="page"><Loading label="Connecting to simulator" /></div>;
  if (error && !status) {
    return (
      <div className="page">
        <Failure title="Simulator unavailable" detail={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const scenario = status?.scenarios.find((item) => item.id === scenarioId);

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Read-only event console</span>
        <h2>SCADA Simulator</h2>
        <p>
          Machine Memory is <strong>not connected to live industrial SCADA</strong>. This feed is
          simulated. Events enter through the same normalized read-only boundary a future historian
          or SCADA adapter would use — and once an event arrives, the investigation is real.
        </p>
      </div>

      {/* What this page actually does, in four steps. */}
      <div className="workflow">
        <span className="wf-step"><b>1</b> Simulator</span>
        <span className="arrow" aria-hidden="true">→</span>
        <span className="wf-step"><b>2</b> Event stream</span>
        <span className="arrow" aria-hidden="true">→</span>
        <span className="wf-step"><b>3</b> Recorded fault</span>
        <span className="arrow" aria-hidden="true">→</span>
        <span className="wf-step"><b>4</b> Machine Memory investigation</span>
      </div>

      <section className="section">
        <div className="section-head">
          <h3>
            <span className={`lamp ${streamLive ? 'live' : ''}`} aria-hidden="true" />
            {streamLive ? 'Simulation connected' : 'Stream disconnected'}
          </h3>
          <span className="sim-badge">Simulation</span>
          <span className="note">source: {status?.source} · read-only · no control channel</span>
        </div>

        <div className="form-grid">
          <label>Asset
            <select value={assetCode} disabled={running} onChange={(event) => setAssetCode(event.target.value)}>
              {assets.map((asset) => <option key={asset.assetCode} value={asset.assetCode}>{asset.assetCode}</option>)}
            </select>
          </label>
          <label>Scenario
            <select value={scenarioId} disabled={running} onChange={(event) => setScenarioId(event.target.value)}>
              {status?.scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Speed
            <select value={speed} disabled={running} onChange={(event) => setSpeed(event.target.value as typeof speed)}>
              <option value="1x">1× ({scenario?.durationSeconds ?? 0}s)</option>
              <option value="fast">Fast demo</option>
            </select>
          </label>
          {scenario && <span className="panel-note field-note">{scenario.summary}</span>}
        </div>

        <div className="button-row">
          <button type="button" className="btn primary" disabled={running || !assetCode} onClick={() => void start()}>
            {running ? 'Streaming…' : 'Start simulation'}
          </button>
          <button type="button" className="btn" disabled={!running} onClick={() => void stop()}>Stop</button>
          <button type="button" className="btn ghost" disabled={running} onClick={() => { setRows([]); setLatestFault(null); setInvestigation(null); }}>
            Clear feed
          </button>
        </div>
        {error && <p className="turn-error">{error}</p>}
      </section>

      {latestFault && (
        <section className="panel fault-banner">
          <div className="panel-head">
            <h3>New fault detected</h3>
            <span className="sim-badge">Simulation</span>
          </div>
          <div className="fault-grid">
            <div><span className="f-label">Asset</span><strong>{latestFault.assetCode}</strong></div>
            <div><span className="f-label">Event</span><code>{latestFault.eventCode}</code></div>
            <div><span className="f-label">Subsystem</span><strong>{latestFault.subsystem ?? '—'}</strong></div>
            <div><span className="f-label">Severity</span><span className="f-sev"><Severity value={latestFault.severity} /></span></div>
          </div>
          {latestFault.signalSnapshot.length > 0 && (
            <>
              <p className="panel-note">
                Simulated signals — illustrative demonstration values, not OEM thresholds. They are
                not evidence and are never cited.
              </p>
              <ul className="signal-list">
                {latestFault.signalSnapshot.map((signal) => (
                  <li key={signal.label}>
                    <span className="s-label">{signal.label}</span>
                    <strong>{signal.value} {signal.unit}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="button-row" style={{ marginTop: 16 }}>
            <button type="button" className="btn primary" onClick={() => onInvestigate(latestFault.assetCode, latestFault.eventCode)}>
              Open in Machine Memory
            </button>
          </div>
        </section>
      )}

      {(investigating || investigation) && (
        <section className="section">
          <div className="section-head">
            <h3>Machine Memory investigation</h3>
            <span className="note">Automatic · same pipeline as a manual investigation</span>
          </div>
          {investigating && !investigation && <p className="thinking">Investigating Machine Memory…</p>}
          {investigation && (
            <>
              <article className={`assessment ${investigation.answer.safetyStatus === 'REFUSED' ? 'refused' : ''}`}>
                <header>
                  <span className="assessment-title">Assessment</span>
                  <Strength value={investigation.answer.evidenceStrength} />
                </header>
                <p className="assessment-summary">{investigation.answer.summary}</p>
                {investigation.answer.findings.length > 0 && (
                  <ul className="findings">
                    {investigation.answer.findings.map((finding, index) => (
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
                {investigation.answer.uncertainties.length > 0 && (
                  <div className="uncertainties">
                    <span>Uncertainties</span>
                    <ul>{investigation.answer.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul>
                  </div>
                )}
              </article>

              <div className="section-head sub">
                <h3>Sources</h3>
                <span className="note">{investigation.evidence.length} retrieved record(s), with provenance</span>
              </div>
              <ul className="library">
                {investigation.evidence.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <div className="source-row static">
                      <span className="s-mark" aria-hidden="true" />
                      <span className="s-body">
                        <span className="s-title">
                          <code>{item.id}</code>
                          <strong>{item.title}</strong>
                        </span>
                      </span>
                      <span className="s-index">
                        <Authority value={item.authorityClass} />
                        <Origin value={item.recordOrigin} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h3>Incoming events</h3>
          <span className="note">Informational rows stay in this feed. Warnings and faults become machine history.</span>
        </div>
        <div className="feed" ref={feedRef}>
          {rows.length === 0 ? (
            <div style={{ padding: '0 16px' }}>
              <Empty title="No events yet">Choose an asset and a scenario, then start the simulated feed.</Empty>
            </div>
          ) : (
            <table className="data-table live">
              <thead>
                <tr><th>Time</th><th>Asset</th><th>Event</th><th>Subsystem</th><th>Severity</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className={row.kind === 'event' ? `sev-${row.severity}` : ''}>
                    <td className="mono">{row.time}</td>
                    <td className="mono">{row.assetCode}</td>
                    <td>{row.eventCode ? <code>{row.eventCode}</code> : <span className="muted">—</span>}</td>
                    <td>{row.subsystem ?? <span className="muted">—</span>}</td>
                    <td>{row.kind === 'event' ? <Severity value={row.severity} /> : <span className="muted">Normal</span>}</td>
                    <td>{row.kind === 'event'
                      ? (row.duplicate ? <span className="count-pill">replay ignored</span> : <span className="count-pill ok">recorded</span>)
                      : <span className="muted">feed only</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
