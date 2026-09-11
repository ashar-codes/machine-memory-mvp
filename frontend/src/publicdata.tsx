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
    <section className="event-summary">
      <div className="section-bar">
        <h2>Recorded events</h2>
        <Origin value={summary.recordOrigin} />
      </div>

      {isPublic && source && (
        <p className="panel-note source-line">
          Source: <a href={source.href} target="_blank" rel="noreferrer noopener">{source.name}</a>
          {summary.sourceTurbine && <> · source turbine {summary.sourceTurbine}</>}
        </p>
      )}

      <div className="summary-figures">
        <div className="figure">
          <span className="f-value">{summary.totalEvents}</span>
          <span className="f-label">Event records</span>
        </div>
        <div className="figure">
          <span className="f-value">{summary.distinctEventCodes}</span>
          <span className="f-label">Distinct codes</span>
        </div>
        <div className="figure">
          <span className="f-value">{summary.firstEventAt ? day(summary.firstEventAt) : '—'}</span>
          <span className="f-label">First record</span>
        </div>
        <div className="figure">
          <span className="f-value">{summary.lastEventAt ? day(summary.lastEventAt) : '—'}</span>
          <span className="f-label">Latest record</span>
        </div>
      </div>

      {!summary.hasMaintenanceRecords && (
        <p className="notice">
          This dataset contains operational events only. It has no work orders, no confirmed root
          causes and no repair records, so no maintenance resolution can be shown for this asset —
          and none is invented to fill the gap.
        </p>
      )}

      <div className="section-head sub">
        <h3>Most frequent codes</h3>
        <span className="note">Counted in SQL over imported rows. Select one to filter the list below.</span>
      </div>
      <ul className="code-chips">
        {summary.topEventCodes.map((item) => (
          <li key={item.eventCode}>
            <button type="button" className="chip"
              aria-pressed={codeFilter === item.eventCode}
              onClick={() => setCodeFilter(codeFilter === item.eventCode ? '' : item.eventCode)}>
              <code>{item.eventCode}</code>
              {item.message && <span className="c-msg">{item.message}</span>}
              <em>{item.occurrences}</em>
            </button>
          </li>
        ))}
      </ul>

      <div className="section-head sub">
        <h3>Recent events</h3>
        <span className="note">
          Newest 25{codeFilter && <> · filtered to <code>{codeFilter}</code></>}
        </span>
        {codeFilter && (
          <span className="actions">
            <button type="button" className="btn ghost small" onClick={() => setCodeFilter('')}>Clear filter</button>
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <Empty title="No matching events">No recorded event in the newest 25 uses that code.</Empty>
      ) : (
        <div className="feed">
          <table className="data-table">
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
