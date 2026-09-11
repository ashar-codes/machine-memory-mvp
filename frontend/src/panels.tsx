import type { Asset, AssetEvent, Evidence, RecordOrigin, TimelineItem } from '@machine-memory/shared';
import { Authority, Empty, Failure, Loading, Origin, Severity, evidenceClass, stamp } from './ui';

/* ---------------------------------------------------------------- asset rail */

/** Short provenance word for the rail. A turbine a user onboarded is not demonstration data. */
const RAIL_ORIGIN: Partial<Record<RecordOrigin, string>> = {
  public_data: 'public', public_reference: 'public', synthetic_demo: 'demo',
  user_demo: 'demo', user_import: 'imported', simulation: 'simulated',
};

export function AssetRail({ assets, selected, onSelect, loading, error, onRetry }: {
  assets: Asset[];
  selected: string;
  onSelect: (assetCode: string) => void;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  // Grouped by site so the fictional demonstration farm can never be confused with public data.
  const sites = new Map<string, Asset[]>();
  for (const asset of assets) {
    const key = `${asset.recordOrigin}::${asset.siteId}`;
    sites.set(key, [...(sites.get(key) ?? []), asset]);
  }

  return (
    <div className="column rail">
      <div className="rail-head">
        <h2>Assets</h2>
        <p>{assets.length} in this workspace</p>
      </div>
      {loading && <Loading label="Loading assets" />}
      {!loading && error && <Failure title="Assets unavailable" detail={error} onRetry={onRetry} />}
      {!loading && !error && assets.length === 0 && (
        <Empty title="No assets yet">Apply the migration and run the seed to load the demonstration turbines.</Empty>
      )}
      {[...sites.entries()].map(([key, group]) => (
        <section className="site-group" key={key}>
          <div className="site-name">
            {/* The real site name, so a public farm is identifiable and not just "public". */}
            <span>{group[0].siteName
              ?? (group[0].recordOrigin === 'public_data' ? 'Public wind farm'
                : group[0].recordOrigin === 'user_import' ? 'Onboarded turbines'
                : 'Demonstration wind farm')}</span>
            <em>{group.length}</em>
            <Origin value={group[0].recordOrigin} />
          </div>
          <ul>
            {group.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  className="asset-row"
                  aria-pressed={selected === asset.assetCode}
                  onClick={() => onSelect(asset.assetCode)}
                >
                  <span className={`bar ${asset.status}`} aria-hidden="true" />
                  <span className="asset-ident">
                    <span className="asset-code">{asset.assetCode}</span>
                    <span className="asset-sub">{asset.status} · {asset.model ?? asset.assetType}</span>
                  </span>
                  <span className="count">{RAIL_ORIGIN[asset.recordOrigin] ?? 'demo'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- asset header */

export function AssetHeader({ asset, event }: { asset: Asset; event: AssetEvent | null }) {
  return (
    <header className="asset-header">
      <div className="asset-identity">
        <div className="asset-title">
          <h1>{asset.assetCode}</h1>
          <div className="asset-descriptor">
            <span className="kind">{asset.assetType.replace(/_/g, ' ')}</span>
            {asset.siteName && <><span className="sep" aria-hidden="true">·</span><span className="make">{asset.siteName}</span></>}
          </div>
        </div>
        <div className="asset-state">
          <span className={`state-pill ${asset.status}`}>{asset.status}</span>
          <Origin value={asset.recordOrigin} />
        </div>
      </div>

      <dl className="spec-grid">
        <div><dt>Manufacturer</dt><dd>{asset.manufacturer || 'Not recorded'}</dd></div>
        <div><dt>Model</dt><dd>{asset.model || 'Not recorded'}</dd></div>
        <div><dt>Serial</dt><dd className="code">{asset.serialNumber || 'Not recorded'}</dd></div>
        <div><dt>Asset type</dt><dd>{asset.assetType.replace(/_/g, ' ')}</dd></div>
      </dl>

      {event ? (
        <div className={`event-card ${event.severity}`}>
          <span className="event-label">Current event</span>
          <div className="event-top">
            <span className="code">{event.eventCode}</span>
            <Severity value={event.severity} />
            <Origin value={event.recordOrigin} />
          </div>
          <h3>{event.title}</h3>
          <p>{event.description || 'No description recorded.'}</p>
          <div className="event-meta">
            <time dateTime={event.occurredAt}>Raised {stamp(event.occurredAt)}</time>
            <span>{event.subsystem || 'Subsystem not recorded'}</span>
            <span className={event.clearedAt ? undefined : 'open-state'}>
              {event.clearedAt ? `Cleared ${stamp(event.clearedAt)}` : 'Open'}
            </span>
          </div>
        </div>
      ) : (
        <div className="event-card">
          <span className="event-label">Current event</span>
          <h3>No open event</h3>
          <p>Nothing is currently uncleared on this asset. That is not a confirmation that the asset is safe to operate.</p>
        </div>
      )}
    </header>
  );
}

/* ----------------------------------------------------------------- timeline */

export function TimelinePanel({ items, loading, error, freshId, onRetry }: {
  items: TimelineItem[];
  loading: boolean;
  error: string;
  freshId: string | null;
  onRetry: () => void;
}) {
  return (
    <section className="timeline-panel">
      <div className="section-bar">
        <h2>Machine memory timeline</h2>
        <span className="hint">Newest first · events, maintenance, notes and logged resolutions</span>
      </div>
      {loading && <Loading label="Loading timeline" />}
      {!loading && error && <Failure title="Timeline unavailable" detail={error} onRetry={onRetry} />}
      {!loading && !error && items.length === 0 && (
        <Empty title="Nothing recorded">This asset has no history in the database yet.</Empty>
      )}
      {!loading && !error && items.length > 0 && (
        <ol className="timeline">
          {items.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className={`entry ${item.kind}${freshId === item.id ? ' fresh' : ''}`}
            >
              <div className="entry-head">
                <span className="entry-kind">{item.kind}</span>
                <time dateTime={item.timestamp}>{stamp(item.timestamp)}</time>
                <Origin value={item.recordOrigin} />
              </div>
              <h4>{item.title}</h4>
              {item.description && <p>{item.description}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- evidence */

/**
 * The source dossier. Provenance (where the record came from) and authority (how much weight it
 * carries) are drawn as two different treatments and are never merged into one badge.
 */
export function EvidencePanel({ evidence, highlighted, registerRef }: {
  evidence: Evidence[];
  highlighted: string | null;
  registerRef: (id: string, node: HTMLLIElement | null) => void;
}) {
  return (
    <div className="column evidence-col">
      <div className="evidence-head">
        <h2>Evidence</h2>
        <p>
          {evidence.length
            ? `${evidence.length} retrieved record${evidence.length === 1 ? '' : 's'}, ranked by authority then relevance`
            : 'Retrieved records appear here with their provenance'}
        </p>
      </div>
      {evidence.length === 0 ? (
        <Empty title="No evidence retrieved">
          Run an investigation to retrieve records. Every claim in an answer must cite one of these.
        </Empty>
      ) : (
        <ol className="evidence-list">
          {evidence.map((item) => (
            <li
              key={item.id}
              ref={(node) => registerRef(item.id, node)}
              className={`ev ${evidenceClass(item)}${highlighted === item.id ? ' flash' : ''}`}
            >
              <div className="ev-top">
                <span className="ev-id">{item.id}</span>
                <Origin value={item.recordOrigin} />
              </div>
              <h4>{item.title}</h4>
              <p className="excerpt">{item.excerpt}</p>
              <div className="ev-facts">
                <span className="kind">{item.sourceType.replace(/_/g, ' ').toLowerCase()}</span>
                {item.assetCode && <span className="code">{item.assetCode}</span>}
                {item.timestamp && <time dateTime={item.timestamp}>{stamp(item.timestamp)}</time>}
              </div>
              <div className="ev-meta">
                <Authority value={item.authorityClass} />
              </div>
              {item.sourceUrl && (
                <a className="ev-link" href={item.sourceUrl} target="_blank" rel="noreferrer noopener">Open source</a>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
