import { useEffect, useState } from 'react';
import type { KnowledgeDetail, KnowledgeSource, KnowledgeUploadReport, ListResponse } from '@machine-memory/shared';
import { del, failureText, get, upload } from './api';
import { Authority, Empty, Loading, Origin } from './ui';

/** A reviewed reference and an unverified upload must never be mistaken for each other. */
const isReviewed = (source: KnowledgeSource) => source.authorityClass !== 'UNVERIFIED';

export function KnowledgeBase({ onIndexed }: { onIndexed: () => void }) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const [title, setTitle] = useState('');
  const [organization, setOrganization] = useState('');
  const [sourceType, setSourceType] = useState<'TECHNICAL_REFERENCE' | 'SAFETY_REFERENCE'>('TECHNICAL_REFERENCE');
  const [model, setModel] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    get<ListResponse<KnowledgeSource>>('/knowledge?limit=50', controller.signal)
      .then((body) => setSources(body.items))
      .catch((cause: unknown) => { const text = failureText(cause); if (text) setError(text); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [reload]);

  const submit = async (file: File | undefined) => {
    if (!file) return;
    if (!title.trim() || !organization.trim()) { setError('Give the document a title and an organization before uploading.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const form = new FormData();
      form.append('title', title.trim());
      form.append('organization', organization.trim());
      form.append('sourceType', sourceType);
      form.append('assetType', 'wind_turbine');
      if (model.trim()) form.append('model', model.trim());
      form.append('file', file);
      const report = await upload<KnowledgeUploadReport>('/knowledge/upload', form);
      setNotice(report.message);
      setTitle(''); setOrganization(''); setModel('');
      setReload((value) => value + 1);
      onIndexed();
    } catch (cause) {
      setError(failureText(cause) || 'The document could not be indexed.');
    } finally { setBusy(false); }
  };

  const open = async (id: string) => {
    setError('');
    try { setDetail(await get<KnowledgeDetail>(`/knowledge/${id}`)); }
    catch (cause) { setError(failureText(cause)); }
  };

  const remove = async (id: string) => {
    setBusy(true); setError('');
    try {
      await del(`/knowledge/${id}`);
      setDetail(null);
      setReload((value) => value + 1);
    } catch (cause) { setError(failureText(cause)); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Retrieval library</span>
        <h2>Knowledge Base</h2>
        <p>
          Everything Machine Memory can retrieve semantically. Reviewed public references carry
          authority and may be quoted as guidance; uploaded documents are evidence only, and are
          labelled unreviewed wherever they are cited.
        </p>
      </div>

      <section className="section">
        <div className="section-head">
          <h3>Index a technical document</h3>
          <span className="note">TXT, Markdown or a text PDF, up to 15 MB. Chunked, embedded with Gemini and searchable immediately.</span>
        </div>
        <div className="form-grid">
          <label>Title<input value={title} maxLength={400} onChange={(event) => setTitle(event.target.value)} placeholder="Gearbox thermal management reference" /></label>
          <label>Organization<input value={organization} maxLength={400} onChange={(event) => setOrganization(event.target.value)} placeholder="Who published it" /></label>
          <label>Type
            <select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)}>
              <option value="TECHNICAL_REFERENCE">Technical reference</option>
              <option value="SAFETY_REFERENCE">Safety procedure</option>
            </select>
          </label>
          <label>Applies to model (optional)<input value={model} maxLength={200} onChange={(event) => setModel(event.target.value)} placeholder="Demo 2MW" /></label>
        </div>
        <label className="file-drop">
          <input type="file" accept=".txt,.md,.pdf" disabled={busy}
            onChange={(event) => { void submit(event.target.files?.[0]); event.target.value = ''; }} />
          <span className="drop-hint">{busy ? 'Chunking and embedding…' : 'Choose a document'}</span>
        </label>
        <p className="panel-note" style={{ marginTop: 10 }}>
          An uploaded document is indexed as an unverified source. It can be retrieved and cited, but
          it never carries the authority of a reviewed public reference.
        </p>
        {notice && <p className="notice success-note">{notice}</p>}
        {error && <p className="turn-error">{error}</p>}
      </section>

      <section className="section">
        <div className="section-head">
          <h3>Indexed sources</h3>
          <span className="note">{sources.length} source{sources.length === 1 ? '' : 's'} · a solid rule marks a reviewed reference, a broken rule an unverified upload</span>
        </div>
        {loading && <Loading label="Loading knowledge base" />}
        {!loading && !sources.length && <Empty title="No sources indexed">Upload a technical document, or run the reviewed public corpus ingestion.</Empty>}
        {!loading && sources.length > 0 && (
          <ul className="library">
            {sources.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  className={`source-row ${isReviewed(source) ? 'reviewed' : 'unverified'}`}
                  onClick={() => void open(source.id)}
                >
                  <span className="s-mark" aria-hidden="true" />
                  <span className="s-body">
                    <span className="s-title">
                      <strong>{source.title}</strong>
                      <Authority value={source.authorityClass} />
                    </span>
                    <span className="s-meta">
                      <span>{source.organization}</span>
                      <span>{source.sourceType.replace(/_/g, ' ').toLowerCase()}</span>
                      <span>{new Date(source.createdAt).toISOString().slice(0, 10)}</span>
                      <Origin value={source.recordOrigin} />
                    </span>
                  </span>
                  <span className="s-index">
                    <span className="count-pill">{source.chunks} chunk{source.chunks === 1 ? '' : 's'}</span>
                    <span className={`count-pill ${source.indexed ? 'ok' : 'warn'}`}>
                      {source.indexed ? 'Indexed' : `${source.embeddedChunks}/${source.chunks} embedded`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail && (
        <section className="panel">
          <div className="panel-head">
            <h3>{detail.source.title}</h3>
            <Authority value={detail.source.authorityClass} />
            <button type="button" className="btn ghost small" onClick={() => setDetail(null)}>Close</button>
          </div>
          <dl className="meta-grid">
            <div><dt>Organization</dt><dd>{detail.source.organization}</dd></div>
            <div><dt>Authority</dt><dd><Authority value={detail.source.authorityClass} /></dd></div>
            <div><dt>Provenance</dt><dd><Origin value={detail.source.recordOrigin} /></dd></div>
            <div><dt>Applies to</dt><dd>{detail.source.model ?? detail.source.assetType ?? 'Not stated'}</dd></div>
            <div><dt>Passages</dt><dd>{detail.source.chunks} ({detail.source.embeddedChunks} embedded)</dd></div>
            <div><dt>Source URL</dt><dd>{detail.source.sourceUrl
              ? <a href={detail.source.sourceUrl} target="_blank" rel="noreferrer noopener">{new URL(detail.source.sourceUrl).hostname}</a>
              : 'None (uploaded document)'}</dd></div>
          </dl>
          <ul className="chunk-list">
            {detail.chunkPreviews.map((chunk) => (
              <li key={chunk.chunkIndex}>
                <span className="chunk-head">
                  <span>#{chunk.chunkIndex}{chunk.section ? ` · ${chunk.section}` : ''}</span>
                  {!chunk.embedded && <span className="count-pill warn">not embedded</span>}
                </span>
                <p>{chunk.excerpt}</p>
              </li>
            ))}
          </ul>
          {detail.source.deletable ? (
            <button type="button" className="btn danger" disabled={busy} onClick={() => void remove(detail.source.id)}>
              Delete this uploaded source
            </button>
          ) : (
            <p className="panel-note">
              This is a reviewed public or foundation source. It cannot be deleted from the interface.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
