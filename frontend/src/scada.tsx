import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Answer, Asset, Evidence, ScadaEventPayload, ScadaStatus, ScadaTelemetryPayload,
  StartSimulationResponse,
} from '@machine-memory/shared';
import { failureText, get, post } from './api';
import { Empty, Failure, Loading, Origin, Severity } from './ui';

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

  if (loading) return <Loading label="Connecting to simulator" />;
  if (error && !status) return <Failure title="Simulator unavailable" detail={error} onRetry={() => window.location.reload()} />;

  const scenario = status?.scenarios.find((item) => item.id === scenarioId);

  return (
    <div className="page">
      <div className="page-head">
        <h2>SCADA Simulator</h2>
        <p>
          Machine Memory is <strong>not connected to live industrial SCADA</strong>. This feed is
          simulated. Events enter through the same normalized read-only boundary a future historian
          or SCADA adapter would use — and once an event arrives, the investigation is real.
        </p>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>
            <span className={`lamp ${streamLive ? 'live' : ''}`} aria-hidden="true" />
            {streamLive ? 'Simulation connected' : 'Stream disconnected'}
          </h3>
          <span className="sim-badge">SIMULATION</span>
          <span className="panel-note">source: {status?.source} · read-only · no control channel</span>
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
        </div>
        {scenario && <p className="panel-note">{scenario.summary}</p>}

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
            <span className="sim-badge">SIMULATION</span>
          </div>
          <div className="fault-grid">
            <div><span>Asset</span><strong>{latestFault.assetCode}</strong></div>
            <div><span>Event</span><code>{latestFault.eventCode}</code></div>
            <div><span>Subsystem</span><strong>{latestFault.subsystem ?? '—'}</strong></div>
            <div><span>Severity</span><Severity value={latestFault.severity} /></div>
          </div>
          {latestFault.signalSnapshot.length > 0 && (
            <>
              <p className="panel-note">Simulated signals — illustrative demonstration values, not OEM thresholds. They are not evidence and are never cited.</p>
              <ul className="signal-list">
                {latestFault.signalSnapshot.map((signal) => (
                  <li key={signal.label}><span>{signal.label}</span><strong>{signal.value} {signal.unit}</strong></li>
                ))}
              </ul>
            </>
          )}
          <div className="button-row">
            <button type="button" className="btn primary" onClick={() => onInvestigate(latestFault.assetCode, latestFault.eventCode)}>
              Open in Machine Memory
            </button>
          </div>
        </section>
      )}

      {(investigating || investigation) && (
        <section className="panel">
          <div className="panel-head">
            <h3>Machine Memory investigation</h3>
            <span className="panel-note">Automatic · same pipeline as a manual investigation</span>
          </div>
          {investigating && !investigation && <p className="thinking">Investigating Machine Memory…</p>}
          {investigation && (
            <>
              <article className={`assessment ${investigation.answer.safetyStatus === 'REFUSED' ? 'refused' : ''}`}>
                <header>
                  <span className="assessment-title">AI assessment</span>
                  <span className={`badge strength-${investigation.answer.evidenceStrength.toLowerCase()}`}>
                    {investigation.answer.evidenceStrength === 'HIGH' ? 'Strong evidence'
                      : investigation.answer.evidenceStrength === 'MODERATE' ? 'Moderate evidence' : 'Insufficient evidence'}
                  </span>
                </header>
                <p className="assessment-summary">{investigation.answer.summary}</p>
                {investigation.answer.findings.length > 0 && (
                  <ul className="findings">
                    {investigation.answer.findings.map((finding, index) => (
                      <li key={index}>
                        <strong>{finding.title}</strong>
                        <p>{finding.detail}</p>
                        <span className="cites">{finding.citationIds.map((id) => <code key={id}>{id}</code>)}</span>
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
              <div className="panel-head" style={{ marginTop: 14 }}>
                <h3>Sources</h3>
                <span className="panel-note">{investigation.evidence.length} retrieved record(s), with provenance</span>
              </div>
              <ul className="record-list">
                {investigation.evidence.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <div className="record static">
                      <span className="record-main">
                        <code>{item.id}</code>
                        <strong>{item.title}</strong>
                        <span className={`badge auth-${item.authorityClass.toLowerCase()}`}>{item.authorityClass}</span>
                      </span>
                      <span className="record-meta"><Origin value={item.recordOrigin} /></span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>Incoming events</h3>
          <span className="panel-note">Informational rows stay in this feed. Warnings and faults become machine history.</span>
        </div>
        <div className="feed" ref={feedRef}>
          {rows.length === 0 ? (
            <Empty title="No events yet">Choose an asset and a scenario, then start the simulated feed.</Empty>
          ) : (
            <table className="feed-table">
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
                    <td>{row.kind === 'event' ? <Severity value={row.severity} /> : <span className="muted">NORMAL</span>}</td>
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
