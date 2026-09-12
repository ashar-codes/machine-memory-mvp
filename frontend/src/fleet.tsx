import { useEffect, useState } from 'react';
import type { FleetSummary, RecurringFault } from '@machine-memory/shared';
import { failureText, get } from './api';
import { Empty, Failure, Loading, Origin } from './ui';

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const minute = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + 'Z';

/** Every number on this page is a database count. Nothing here is estimated or illustrative. */
export function FleetDashboard({ onOpenAsset }: { onOpenAsset: (assetCode: string) => void }) {
  const [summary, setSummary] = useState<FleetSummary | null>(null);
  const [recurring, setRecurring] = useState<RecurringFault[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      get<FleetSummary>('/fleet/summary', controller.signal),
      get<{ items: RecurringFault[] }>('/fleet/recurring-faults', controller.signal),
    ])
      .then(([totals, faults]) => { setSummary(totals); setRecurring(faults.items); })
      .catch((cause: unknown) => { const text = failureText(cause); if (text) setError(text); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [reload]);

  if (loading) return <div className="page"><Loading label="Loading fleet" /></div>;
  if (error) {
    return (
      <div className="page">
        <Failure title="Fleet unavailable" detail={error} onRetry={() => setReload((v) => v + 1)} />
      </div>
    );
  }
  if (!summary) return <div className="page"><Empty title="No fleet data">Add a turbine to begin.</Empty></div>;

  const { totals } = summary;

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Operational overview</span>
        <h2>Fleet</h2>
        <p>
          Counts are live database queries over recorded rows. They describe what has been logged,
          not the condition of the machines.
        </p>
      </div>

      {/* Three tiers of weight, not eight identical cards. */}
      <div className="metric-primary">
        <div className="metric">
          <span className="metric-value">{totals.assets}</span>
          <span className="metric-label">Assets</span>
        </div>
        <div className="metric ok">
          <span className="metric-value">{totals.healthy}</span>
          <span className="metric-label">Healthy</span>
        </div>
        <div className="metric bad">
          <span className="metric-value">{totals.faulted}</span>
          <span className="metric-label">Faulted</span>
        </div>
      </div>

      <div className="metric-row">
        <div className="metric warn">
          <span className="metric-value">{totals.warning}</span>
          <span className="metric-label">Warnings</span>
        </div>
        <div className="metric">
          <span className="metric-value">{totals.openIncidents}</span>
          <span className="metric-label">Open incidents</span>
        </div>
        <div className="metric">
          <span className="metric-value">{totals.recurringFaults}</span>
          <span className="metric-label">Recurring faults</span>
        </div>
      </div>

      <div className="metric-strip">
        <span className="item"><b>{totals.knowledgeSources}</b> knowledge sources indexed</span>
        <span className="item"><b>{totals.knowledgeChunks}</b> passages retrievable</span>
      </div>

      <section className="section">
        <div className="section-head">
          <h3>Recurring faults</h3>
          <span className="note">
            Same asset, same event code, at least 2 occurrences in 365 days. A counting rule, not a diagnosis.
          </span>
        </div>
        {recurring.length === 0 ? (
          <Empty title="No recurring faults">No asset has recorded the same event code twice in the window.</Empty>
        ) : (
          <ul className="fault-register">
            {recurring.map((fault) => (
              <li key={`${fault.assetCode}-${fault.eventCode}`}>
                <button
                  type="button"
                  className="fault-entry"
                  onClick={() => onOpenAsset(fault.assetCode)}
                  title={`Open ${fault.assetCode} in Machine Memory`}
                >
                  <span className="f-asset">{fault.assetCode}</span>
                  <span className="f-code">{fault.eventCode}</span>
                  <span className="f-count">
                    <b>{fault.occurrences}</b>
                    <span>occurrences</span>
                  </span>
                  <span className="f-span">
                    {day(fault.firstAt)} <em aria-hidden="true">→</em> {day(fault.lastAt)}
                  </span>
                  <span className="f-tags">
                    {fault.openNow && <span className="count-pill open">open now</span>}
                    {fault.recordOrigins.map((origin) => <Origin key={origin} value={origin} />)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h3>Recent machine memory</h3>
          <span className="note">The newest records the system has learned, whatever their provenance.</span>
        </div>
        {summary.recentMemory.length === 0 ? (
          <Empty title="Nothing recorded yet">Import history or index a document to populate machine memory.</Empty>
        ) : (
          <ul className="stream">
            {summary.recentMemory.map((item, index) => (
              <li key={`${item.timestamp}-${index}`}>
                <span className="s-kind">{item.kind}</span>
                <div className="s-body">
                  <span className="s-title">
                    <strong>{item.title}</strong>
                    {item.assetCode && <code>{item.assetCode}</code>}
                  </span>
                  {item.detail && <p className="s-detail">{item.detail}</p>}
                  <span className="s-meta">
                    <time dateTime={item.timestamp}>{minute(item.timestamp)}</time>
                    <Origin value={item.recordOrigin} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
