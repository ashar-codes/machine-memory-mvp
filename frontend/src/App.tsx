import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Asset, AssetEvent, AssetResponse, CurrentEventResponse, Evidence, HealthResponse,
  Intent, InvestigateResponse, ListResponse, ResolutionRequest, ResolutionResponse, TimelineItem,
} from '@machine-memory/shared';
import { failureText, get, post } from './api';
import { CopilotView } from './copilot';
import { DataHub } from './datahub';
import { FleetDashboard } from './fleet';
import { AnswerCard, InvestigationPanel, ResolutionDrawer } from './investigation';
import { KnowledgeBase } from './knowledge';
import { AssetHeader, AssetRail, EvidencePanel, TimelinePanel } from './panels';
import { EventSummaryPanel } from './publicdata';
import { ScadaSimulator } from './scada';
import { ScenarioLab } from './scenario';
import { Empty, Failure, Loading } from './ui';

const VIEWS = ['fleet', 'memory', 'copilot', 'scada', 'data', 'knowledge', 'scenario'] as const;
type View = typeof VIEWS[number];
const VIEW_LABELS: Record<View, string> = {
  fleet: 'Fleet', memory: 'Machine Memory', copilot: 'AI Copilot', scada: 'SCADA Simulator',
  data: 'Data Hub', knowledge: 'Knowledge Base', scenario: 'Scenario Lab',
};

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsError, setAssetsError] = useState('');
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [selected, setSelected] = useState('');
  const [reload, setReload] = useState(0);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [event, setEvent] = useState<AssetEvent | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailReload, setDetailReload] = useState(0);

  const [result, setResult] = useState<InvestigateResponse | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [running, setRunning] = useState(false);
  const [investigationError, setInvestigationError] = useState('');
  const [activeProbe, setActiveProbe] = useState<string | null>(null);
  const lastRequest = useRef<{ intent: Intent; question: string; probeId: string | null } | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState<{ id: string; summary: string } | null>(null);

  const [view, setView] = useState<View>('memory');
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const evidenceRefs = useRef(new Map<string, HTMLLIElement>());
  const registerRef = useCallback((id: string, node: HTMLLIElement | null) => {
    if (node) evidenceRefs.current.set(id, node);
    else evidenceRefs.current.delete(id);
  }, []);

  /* --------------------------------------------------- health and asset list */
  useEffect(() => {
    const controller = new AbortController();
    setAssetsLoading(true);
    setAssetsError('');
    void get<HealthResponse>('/health', controller.signal).then(setHealth).catch(() => setHealth(null));
    void get<ListResponse<Asset>>('/assets?limit=100', controller.signal)
      .then((list) => {
        setAssets(list.items);
        setSelected((previous) =>
          list.items.some((item) => item.assetCode === previous)
            ? previous
            // The demonstration hero turbine is preferred when present, otherwise the first asset.
            : list.items.find((item) => item.assetCode === 'WT-07')?.assetCode ?? list.items[0]?.assetCode ?? '');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAssets([]);
        setSelected('');
        setAssetsError(failureText(error));
      })
      .finally(() => { if (!controller.signal.aborted) setAssetsLoading(false); });
    return () => controller.abort();
  }, [reload]);

  /* ------------------------------------------------------------ asset detail */
  useEffect(() => {
    if (!selected) { setAsset(null); setEvent(null); setTimeline([]); return; }
    const controller = new AbortController();
    const path = `/assets/${encodeURIComponent(selected)}`;
    setDetailLoading(true);
    setDetailError('');
    void Promise.all([
      get<AssetResponse>(path, controller.signal),
      get<CurrentEventResponse>(`${path}/current-event`, controller.signal),
      get<ListResponse<TimelineItem>>(`${path}/timeline?limit=50`, controller.signal),
    ])
      .then(([detail, current, history]) => {
        setAsset(detail.asset);
        setEvent(current.event);
        setTimeline(history.items);
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setDetailError(failureText(error)); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selected, detailReload]);

  /* --------------------------------------------------------- asset switching */
  const chooseAsset = (assetCode: string) => {
    setSelected(assetCode);
    // An answer belongs to the asset it was asked about; never carry it across a selection change.
    setResult(null);
    setEvidence([]);
    setActiveProbe(null);
    setInvestigationError('');
    setSavedNotice(null);
    lastRequest.current = null;
  };

  /* ------------------------------------------------------------ investigation */
  const runInvestigation = useCallback(async (intent: Intent, question: string, probeId: string | null) => {
    if (!selected) return;
    lastRequest.current = { intent, question, probeId };
    setRunning(true);
    setInvestigationError('');
    setActiveProbe(probeId);
    setHighlighted(null);
    try {
      const response = await post<InvestigateResponse>('/investigate', {
        assetCode: selected,
        ...(event?.eventCode ? { eventCode: event.eventCode } : {}),
        intent,
        question,
      });
      setResult(response);
      setEvidence(response.evidence);
    } catch (error) {
      setResult(null);
      setEvidence([]);
      setInvestigationError(failureText(error) || 'The investigation could not be completed. Retry.');
    } finally {
      setRunning(false);
    }
  }, [selected, event?.eventCode]);

  const retryInvestigation = () => {
    const previous = lastRequest.current;
    if (previous) void runInvestigation(previous.intent, previous.question, previous.probeId);
  };

  const jumpToEvidence = (id: string) => {
    setHighlighted(id);
    evidenceRefs.current.get(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  /* -------------------------------------------------------- resolution saving */
  const saveResolution = async (payload: ResolutionRequest) => {
    const response = await post<ResolutionResponse>('/resolutions', payload);
    setDrawerOpen(false);
    setSavedNotice({ id: response.resolution.id, summary: response.resolution.resolutionSummary });
    // Structured memory is committed, so the timeline reflects it immediately.
    setDetailReload((value) => value + 1);
  };

  const databaseState = health?.database ?? null;
  const lamp = databaseState === 'connected' ? 'live' : databaseState === 'unavailable' ? 'down' : 'warn';
  const canInvestigate = Boolean(asset) && databaseState !== 'not_configured';

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">Machine Memory<span>Turbine maintenance intelligence</span></span>
        <span className="topbar-spacer" />
        <div className="status-strip">
          <span className="status-item">
            <span className={`lamp ${lamp}`} aria-hidden="true" />
            {databaseState === 'connected' ? 'Database connected'
              : databaseState === 'unavailable' ? 'Database unavailable'
              : databaseState === 'not_configured' ? 'Database not configured'
              : 'Checking backend'}
          </span>
          <span className="status-item">
            <span className={`lamp ${health?.llm === 'configured_unverified' ? 'live' : ''}`} aria-hidden="true" />
            {health?.llm === 'configured_unverified' ? 'Model key present' : 'No model key'}
          </span>
        </div>
      </header>

      <nav className="mainnav" aria-label="Sections">
        {VIEWS.map((item) => (
          <button key={item} type="button" className={`navlink ${view === item ? 'active' : ''}`}
            aria-current={view === item ? 'page' : undefined} onClick={() => setView(item)}>
            {VIEW_LABELS[item]}
          </button>
        ))}
      </nav>

      {/* The grid keeps three fixed tracks, so a view without the rail and evidence panel must
          collapse to a single full-width track rather than rendering inside the rail's column. */}
      <div className={`workspace${view === 'memory' || view === 'copilot' ? '' : ' full'}`}>
        {(view === 'memory' || view === 'copilot') && (
          <AssetRail
            assets={assets}
            selected={selected}
            onSelect={chooseAsset}
            loading={assetsLoading}
            error={assetsError}
            onRetry={() => setReload((value) => value + 1)}
          />
        )}

        <main className="column centre">
          {view === 'fleet' && (
            <FleetDashboard onOpenAsset={(assetCode) => { chooseAsset(assetCode); setView('memory'); }} />
          )}
          {view === 'copilot' && (
            <CopilotView assetCode={asset?.assetCode ?? null} eventCode={event?.eventCode ?? null} onEvidence={setEvidence} />
          )}
          {view === 'data' && (
            <DataHub onImported={(report) => {
              setReload((value) => value + 1);
              setDetailReload((value) => value + 1);
              if (report.assetsTouched.length) chooseAsset(report.assetsTouched[0]);
            }} />
          )}
          {view === 'scada' && (
            <ScadaSimulator
              assets={assets}
              onFault={(faultAsset) => {
                // The fault is already recorded; refresh so the rail, status and timeline agree.
                setReload((value) => value + 1);
                chooseAsset(faultAsset);
                setDetailReload((value) => value + 1);
              }}
              onInvestigate={(faultAsset) => { chooseAsset(faultAsset); setView('memory'); setDetailReload((value) => value + 1); }}
            />
          )}
          {view === 'knowledge' && <KnowledgeBase onIndexed={() => setReload((value) => value + 1)} />}
          {view === 'scenario' && (
            <ScenarioLab
              assets={assets}
              onAssetCreated={(created) => { setReload((value) => value + 1); chooseAsset(created.assetCode); }}
              onEventCreated={(assetCode) => { setReload((value) => value + 1); chooseAsset(assetCode); setDetailReload((value) => value + 1); }}
            />
          )}
          {view === 'memory' && <>
          {health?.llm !== 'configured_unverified' && databaseState === 'connected' && (
            <p className="notice">
              No model key is configured. Investigations still run: evidence is retrieved from the
              database and answers are assembled deterministically from it, without semantic ranking.
            </p>
          )}

          {savedNotice && (
            <div className="saved-banner" role="status">
              Added to machine memory
              <span className="note">
                Saved as user demo data and already retrievable. Ask “How was it solved previously?” to see it.
              </span>
              <button type="button" className="btn ghost" onClick={() => setSavedNotice(null)}>Dismiss</button>
            </div>
          )}

          {detailLoading && <Loading label={`Loading ${selected}`} />}
          {!detailLoading && detailError && (
            <Failure title="Asset unavailable" detail={detailError} onRetry={() => setDetailReload((value) => value + 1)} />
          )}
          {!detailLoading && !detailError && !asset && (
            <Empty title="Select an asset">
              Choose a turbine to see its current event, its recorded history, and to investigate it.
            </Empty>
          )}

          {!detailLoading && !detailError && asset && (
            <>
              <AssetHeader asset={asset} event={event} />
              <InvestigationPanel
                activeProbe={activeProbe}
                running={running}
                disabled={!canInvestigate}
                canLogResolution={Boolean(event?.eventCode)}
                onRun={(intent, question, probeId) => void runInvestigation(intent, question, probeId)}
                onLogResolution={() => setDrawerOpen(true)}
              />
              <div className="investigate" style={{ paddingTop: 0 }}>
                <AnswerCard
                  answer={result?.answer ?? null}
                  running={running}
                  error={investigationError}
                  onRetry={retryInvestigation}
                  onCite={jumpToEvidence}
                />
              </div>
              <EventSummaryPanel assetCode={asset.assetCode} reload={detailReload} />
              <TimelinePanel
                items={timeline}
                loading={false}
                error=""
                freshId={savedNotice?.id ?? null}
                onRetry={() => setDetailReload((value) => value + 1)}
              />
              <p className="safety-footer">
                Machine Memory reports what is recorded. It does not issue maintenance instructions,
                approve work, or authorize any deviation from protection systems. Historical records
                describe what was done before, not what is approved now. Follow site procedures and
                equipment documentation.
              </p>
            </>
          )}
          </>}
        </main>

        {(view === 'memory' || view === 'copilot') && (
          <EvidencePanel evidence={evidence} highlighted={highlighted} registerRef={registerRef} />
        )}
      </div>

      {drawerOpen && asset && event?.eventCode && (
        <ResolutionDrawer
          assetCode={asset.assetCode}
          eventCode={event.eventCode}
          onClose={() => setDrawerOpen(false)}
          onSave={saveResolution}
        />
      )}
    </div>
  );
}
