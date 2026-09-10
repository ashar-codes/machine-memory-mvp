import { useEffect, useState } from 'react';
import type { FleetSummary, RecurringFault } from '@machine-memory/shared';
import { failureText, get } from './api';
import { Empty, Failure, Loading, Origin } from './ui';

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

  if (loading) return <Loading label="Loading fleet" />;
  if (error) return <Failure title="Fleet unavailable" detail={error} onRetry={() => setReload((v) => v + 1)} />;
  if (!summary) return <Empty title="No fleet data">Add a turbine to begin.</Empty>;

  const tiles: { label: string; value: number; tone?: string }[] = [
    { label: 'Assets', value: summary.totals.assets },
    { label: 'Healthy', value: summary.totals.healthy, tone: 'ok' },
    { label: 'Warning', value: summary.totals.warning, tone: 'warn' },
    { label: 'Faulted', value: summary.totals.faulted, tone: 'bad' },
    { label: 'Open incidents', value: summary.totals.openIncidents },
    { label: 'Recurring faults', value: summary.totals.recurringFaults },
    { label: 'Knowledge sources', value: summary.totals.knowledgeSources },
    { label: 'Indexed passages', value: summary.totals.knowledgeChunks },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h2>Fleet</h2>
        <p>Counts are live database queries over recorded rows. They describe what has been logged, not the condition of the machines.</p>
      </div>

      <div className="tile-grid">
        {tiles.map((tile) => (
          <div key={tile.label} className={`tile ${tile.tone ?? ''}`}>
            <span className="tile-value">{tile.value}</span>
            <span className="tile-label">{tile.label}</span>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Recurring faults</h3>
          <span className="panel-note">Same asset, same event code, at least 2 occurrences in 365 days. A counting rule, not a diagnosis.</span>
        </div>
        {recurring.length === 0 ? (
          <Empty title="No recurring faults">No asset has recorded the same event code twice in the window.</Empty>
        ) : (
          <ul className="record-list">
            {recurring.map((fault) => (
              <li key={`${fault.assetCode}-${fault.eventCode}`}>
                <button type="button" className="record" onClick={() => onOpenAsset(fault.assetCode)}>
                  <span className="record-main">
                    <strong>{fault.assetCode}</strong>
                    <code>{fault.eventCode}</code>
                    <span className="count-pill">{fault.occurrences} occurrences</span>
                    {fault.openNow && <span className="count-pill open">open now</span>}
                  </span>
                  <span className="record-meta">
                    {new Date(fault.firstAt).toISOString().slice(0, 10)} → {new Date(fault.lastAt).toISOString().slice(0, 10)}
                    {fault.recordOrigins.map((origin) => <Origin key={origin} value={origin} />)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Recent Machine Memory</h3>
          <span className="panel-note">The newest records the system has learned, whatever their provenance.</span>
        </div>
        {summary.recentMemory.length === 0 ? (
          <Empty title="Nothing recorded yet">Import history or index a document to populate machine memory.</Empty>
        ) : (
          <ul className="record-list">
            {summary.recentMemory.map((item, index) => (
              <li key={`${item.timestamp}-${index}`}>
                <div className="record static">
                  <span className="record-main">
                    <span className={`kind-tag ${item.kind.toLowerCase()}`}>{item.kind}</span>
                    <strong>{item.title}</strong>
                    {item.assetCode && <code>{item.assetCode}</code>}
                  </span>
                  <span className="record-meta">
                    {new Date(item.timestamp).toISOString().replace('T', ' ').slice(0, 16)}Z
                    <Origin value={item.recordOrigin} />
                  </span>
                  {item.detail && <p className="record-detail">{item.detail}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
