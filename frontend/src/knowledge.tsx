import { useEffect, useState } from 'react';
import type { KnowledgeDetail, KnowledgeSource, KnowledgeUploadReport, ListResponse } from '@machine-memory/shared';
import { del, failureText, get, upload } from './api';
import { Empty, Loading, Origin } from './ui';

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
        <h2>Knowledge Base</h2>
        <p>
          Everything Machine Memory can retrieve semantically. Reviewed public references carry
          authority and may be quoted as guidance; uploaded documents are evidence only, and are
          labelled unreviewed wherever they are cited.
        </p>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Index a technical document</h3>
          <span className="panel-note">TXT, Markdown or a text PDF, up to 15 MB. Chunked, embedded with Gemini and searchable immediately.</span>
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
          <span>{busy ? 'Chunking and embedding…' : 'Choose a document'}</span>
        </label>
        {notice && <p className="notice success-note">{notice}</p>}
        {error && <p className="turn-error">{error}</p>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Indexed sources</h3>
          <span className="panel-note">{sources.length} source{sources.length === 1 ? '' : 's'}</span>
        </div>
        {loading && <Loading label="Loading knowledge base" />}
        {!loading && !sources.length && <Empty title="No sources indexed">Upload a technical document, or run the reviewed public corpus ingestion.</Empty>}
        {!loading && sources.length > 0 && (
          <ul className="record-list">
            {sources.map((source) => (
              <li key={source.id}>
                <button type="button" className="record" onClick={() => void open(source.id)}>
                  <span className="record-main">
                    <strong>{source.title}</strong>
                    <span className={`badge auth-${source.authorityClass.toLowerCase()}`}>{source.authorityClass}</span>
                    <span className="count-pill">{source.chunks} chunk{source.chunks === 1 ? '' : 's'}</span>
                    <span className={`count-pill ${source.indexed ? 'ok' : 'warn'}`}>
                      {source.indexed ? 'Indexed' : `${source.embeddedChunks}/${source.chunks} embedded`}
                    </span>
                  </span>
                  <span className="record-meta">
                    {source.organization} · {source.sourceType.replace(/_/g, ' ').toLowerCase()}
                    · {new Date(source.createdAt).toISOString().slice(0, 10)}
                    <Origin value={source.recordOrigin} />
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
            <button type="button" className="btn ghost" onClick={() => setDetail(null)}>Close</button>
          </div>
          <dl className="meta-grid">
            <div><dt>Organization</dt><dd>{detail.source.organization}</dd></div>
            <div><dt>Authority</dt><dd>{detail.source.authorityClass}</dd></div>
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
                  #{chunk.chunkIndex}{chunk.section ? ` · ${chunk.section}` : ''}
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
