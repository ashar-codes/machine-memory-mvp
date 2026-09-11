import { useEffect, useState } from 'react';
import type { AssetEventSummary } from '@machine-memory/shared';
import { failureText, get } from './api';
import { Empty, Origin, Severity } from './ui';

const SOURCE_LABELS: Record<string, { name: string; href: string }> = {
  penmanshiel_zenodo: { name: 'Cubico Sustainable Investments Ltd · Zenodo', href: 'https://zenodo.org/records/16807304' },
};

const stamp = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * Recorded-event facts for an asset. Every number is a count over imported rows — there is no
 * estimate, no projection and no derived score anywhere on this panel.
 */
export function EventSummaryPanel({ assetCode, reload }: { assetCode: string; reload: number }) {
  const [summary, setSummary] = useState<AssetEventSummary | null>(null);
  const [error, setError] = useState('');
  const [codeFilter, setCodeFilter] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setSummary(null);
    setError('');
    setCodeFilter('');
    get<AssetEventSummary>(`/assets/${encodeURIComponent(assetCode)}/event-summary`, controller.signal)
      .then(setSummary)
      .catch((cause: unknown) => { const text = failureText(cause); if (text) setError(text); });
    return () => controller.abort();
  }, [assetCode, reload]);

  if (error) return null;
  if (!summary || summary.totalEvents === 0) return null;

  const isPublic = summary.recordOrigin === 'public_data';
  const source = summary.source ? SOURCE_LABELS[summary.source] : undefined;
  const rows = codeFilter
    ? summary.recentEvents.filter((item) => item.eventCode === codeFilter)
    : summary.recentEvents;

  return (
    <section className="panel event-summary">
      <div className="panel-head">
        <h3>Recorded events</h3>
        <Origin value={summary.recordOrigin} />
        {isPublic && source && (
          <span className="panel-note">
            Source: <a href={source.href} target="_blank" rel="noreferrer noopener">{source.name}</a>
            {summary.sourceTurbine && <> · source turbine {summary.sourceTurbine}</>}
          </span>
        )}
      </div>

      <div className="tile-grid compact">
        <div className="tile"><span className="tile-value">{summary.totalEvents}</span><span className="tile-label">Event records</span></div>
        <div className="tile"><span className="tile-value">{summary.distinctEventCodes}</span><span className="tile-label">Distinct codes</span></div>
        <div className="tile"><span className="tile-value">{summary.firstEventAt ? day(summary.firstEventAt) : '—'}</span><span className="tile-label">First record</span></div>
        <div className="tile"><span className="tile-value">{summary.lastEventAt ? day(summary.lastEventAt) : '—'}</span><span className="tile-label">Latest record</span></div>
      </div>

      {!summary.hasMaintenanceRecords && (
        <p className="notice">
          This dataset contains operational events only. It has no work orders, no confirmed root
          causes and no repair records, so no maintenance resolution can be shown for this asset —
          and none is invented to fill the gap.
        </p>
      )}

      <div className="panel-head" style={{ marginTop: 12 }}>
        <h3>Most frequent codes</h3>
        <span className="panel-note">Counted in SQL over imported rows. Click one to filter the list below.</span>
      </div>
      <ul className="code-chips">
        {summary.topEventCodes.map((item) => (
          <li key={item.eventCode}>
            <button type="button" className={`chip ${codeFilter === item.eventCode ? 'active' : ''}`}
              aria-pressed={codeFilter === item.eventCode}
              onClick={() => setCodeFilter(codeFilter === item.eventCode ? '' : item.eventCode)}>
              <code>{item.eventCode}</code>
              {item.message && <span>{item.message}</span>}
              <em>{item.occurrences}</em>
            </button>
          </li>
        ))}
      </ul>

      <div className="panel-head" style={{ marginTop: 12 }}>
        <h3>Recent events</h3>
        <span className="panel-note">
          Newest 25{codeFilter && <> · filtered to <code>{codeFilter}</code></>}
        </span>
        {codeFilter && <button type="button" className="btn ghost" onClick={() => setCodeFilter('')}>Clear filter</button>}
      </div>
      {rows.length === 0 ? (
        <Empty title="No matching events">No recorded event in the newest 25 uses that code.</Empty>
      ) : (
        <div className="feed">
          <table className="feed-table">
            <thead>
              <tr><th>Timestamp</th><th>Code</th><th>Message</th><th>Source status</th><th>Duration</th><th>Provenance</th></tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <td className="mono">{stamp(item.occurredAt)}</td>
                  <td><code>{item.eventCode}</code></td>
                  <td>{item.title}</td>
                  <td>
                    {/* The source's own classification, shown verbatim next to our conservative severity. */}
                    {item.sourceStatus ? <span className="count-pill">{item.sourceStatus}</span> : <Severity value={item.severity} />}
                  </td>
                  <td className="mono">{item.duration ?? <span className="muted">—</span>}</td>
                  <td><Origin value={item.recordOrigin} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
