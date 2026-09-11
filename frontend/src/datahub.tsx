import { useState } from 'react';
import type { ImportPreview, ImportReport, ImportType, MappingStatus } from '@machine-memory/shared';
import { failureText, post, upload } from './api';
import { Empty } from './ui';

const IMPORT_CHOICES: { type: ImportType; label: string; blurb: string }[] = [
  { type: 'EVENT_LOG', label: 'Event / fault log', blurb: 'Alarms and faults with timestamps' },
  { type: 'MAINTENANCE_HISTORY', label: 'Maintenance history', blurb: 'Inspections, services, replacements' },
  { type: 'WORK_ORDERS', label: 'Work orders', blurb: 'Summaries, causes and outcomes' },
  { type: 'TECHNICIAN_NOTES', label: 'Technician notes', blurb: 'Free-text observations' },
];

/** Categories a user may reasonably expect. Marked honestly rather than faked. */
const UNSUPPORTED: { label: string; reason: string }[] = [
  { label: 'SCADA / sensor data', reason: 'Large telemetry sets need batch processing. Upload a bounded event-log subset instead.' },
  { label: 'XLSX / XLS spreadsheets', reason: 'Not supported in this MVP. Export the sheet as CSV and upload that.' },
  { label: 'Scanned PDF reports', reason: 'No OCR in this MVP. A text PDF or .txt file works.' },
];

const STATUS_LABEL: Record<MappingStatus, string> = {
  HIGH_MATCH: 'High match', SUGGESTED: 'Suggested', NEEDS_REVIEW: 'Needs review', UNMAPPED: 'Unmapped',
};

export function DataHub({ onImported }: { onImported: (report: ImportReport) => void }) {
  const [importType, setImportType] = useState<ImportType>('EVENT_LOG');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [simulation, setSimulation] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(''); setReport(null); setPreview(null);
    try {
      const form = new FormData();
      form.append('importType', importType);
      form.append('file', file);
      const result = await upload<ImportPreview>('/import/preview', form);
      setPreview(result);
      const initial: Record<string, string> = {};
      for (const entry of result.mapping) if (entry.field) initial[entry.column] = entry.field;
      setMapping(initial);
    } catch (cause) {
      setError(failureText(cause) || 'The file could not be read.');
    } finally { setBusy(false); }
  };

  const assigned = new Set(Object.values(mapping));
  const missingRequired = preview
    ? preview.targetFields.filter((field) => field.required && !assigned.has(field.field)).map((field) => field.field)
    : [];

  const commit = async () => {
    if (!preview || missingRequired.length) return;
    setBusy(true); setError('');
    try {
      const result = await post<ImportReport>('/import/commit', {
        dataSourceId: preview.dataSourceId, importType: preview.importType, mapping, simulation,
      });
      setReport(result);
      setPreview(null);
      onImported(result);
    } catch (cause) {
      setError(failureText(cause) || 'The import could not be committed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Data ingestion</span>
        <h2>Data Hub</h2>
        <p>
          Add operational history to Machine Memory from a CSV export. Gemini proposes the column
          mapping. Preview saves source metadata; operational rows are imported after you confirm,
          with user import or simulation provenance.
        </p>
      </div>

      <section className="step done">
        <div className="step-head">
          <span className="step-num">1</span>
          <h3>Choose the data type</h3>
        </div>
        <div className="choice-grid">
          {IMPORT_CHOICES.map((choice) => (
            <button key={choice.type} type="button"
              className="choice"
              aria-pressed={importType === choice.type}
              onClick={() => { setImportType(choice.type); setPreview(null); setReport(null); }}>
              <strong>{choice.label}</strong>
              <span>{choice.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={`step${preview || report ? ' done' : ''}`}>
        <div className="step-head">
          <span className="step-num">2</span>
          <h3>Upload the file</h3>
          <span className="panel-note">CSV or TSV, up to 10 MB and 5,000 rows.</span>
        </div>
        <label className="file-drop">
          <input type="file" accept=".csv,.tsv,.txt" disabled={busy}
            onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
          <span className="drop-hint">{busy ? 'Reading file…' : 'Choose a CSV file'}</span>
        </label>
        {error && <p className="turn-error">{error}</p>}
      </section>

      {preview && (
        <section className="step">
          <div className="step-head">
            <span className="step-num">3</span>
            <h3>Review the column mapping</h3>
            <span className="panel-note">
              {preview.totalRows} data row{preview.totalRows === 1 ? '' : 's'} in {preview.originalFilename}
              {preview.mappingSource === 'ai' ? ' · Gemini proposed part of this mapping' : ' · matched deterministically'}
            </span>
          </div>

          {preview.mappingSource === 'ai' && (
            <p className="notice">
              Proposed mappings are suggestions only. Nothing is imported until you confirm the
              assignments below.
            </p>
          )}
          {preview.notes.map((note) => <p className="notice" key={note}>{note}</p>)}

          <div className="table-wrap">
            <table className="mapping-table">
              <thead>
                <tr><th>Uploaded column</th><th>Sample value</th><th>Machine Memory field</th><th>Status</th></tr>
              </thead>
              <tbody>
                {preview.mapping.map((entry) => {
                  const sample = preview.sampleRows.map((row) => row[entry.column]).find(Boolean) ?? '—';
                  const current = mapping[entry.column] ?? '';
                  return (
                    <tr key={entry.column}>
                      <td><code>{entry.column}</code></td>
                      <td className="sample">{sample.slice(0, 48)}</td>
                      <td>
                        <select
                          aria-label={`Machine Memory field for column ${entry.column}`}
                          value={current}
                          onChange={(event) => {
                            const next = { ...mapping };
                            if (event.target.value) next[entry.column] = event.target.value;
                            else delete next[entry.column];
                            setMapping(next);
                          }}>
                          <option value="">— ignore this column —</option>
                          {preview.targetFields.map((field) => (
                            <option key={field.field} value={field.field}
                              disabled={assigned.has(field.field) && current !== field.field}>
                              {field.label}{field.required ? ' *' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className={`map-status ${entry.status.toLowerCase()}`}>{STATUS_LABEL[entry.status]}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {missingRequired.length > 0 && (
            <p className="blocking">
              Required field{missingRequired.length === 1 ? '' : 's'} not mapped: {missingRequired.join(', ')}.
              Assign {missingRequired.length === 1 ? 'it' : 'them'} before importing.
            </p>
          )}

          <div className="step-head" style={{ marginTop: 24 }}>
            <span className="step-num">4</span>
            <h3>Confirm and import</h3>
          </div>

          <label className="check-row">
            <input type="checkbox" checked={simulation} onChange={(event) => setSimulation(event.target.checked)} />
            Mark this import as simulated data (visible everywhere as simulation provenance)
          </label>

          <button type="button" className="btn primary" disabled={busy || missingRequired.length > 0} onClick={() => void commit()}>
            {busy ? 'Importing…' : `Import ${preview.totalRows} row${preview.totalRows === 1 ? '' : 's'}`}
          </button>
        </section>
      )}

      {report && (
        <section className="panel success">
          <div className="panel-head"><h3>Import complete</h3></div>
          <p>
            {report.rowsImported} of {report.rowsReceived} row{report.rowsReceived === 1 ? '' : 's'} imported
            as <strong>{report.recordOrigin}</strong>
            {report.assetsTouched.length > 0 && <> · {report.assetsTouched.join(', ')}</>}
          </p>
          {report.rowsRejected > 0 && (
            <>
              <p className="blocking">{report.rowsRejected} row{report.rowsRejected === 1 ? '' : 's'} rejected and not imported:</p>
              <ul className="rejections">
                {report.rejections.map((rejection) => (
                  <li key={rejection.row}>Row {rejection.row}: {rejection.reason}</li>
                ))}
              </ul>
            </>
          )}
          <p className="panel-note">This history is retrievable now. Ask the copilot about the asset.</p>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h3>Not supported in this MVP</h3>
          <span className="note">Named honestly rather than silently failing.</span>
        </div>
        <ul className="record-list">
          {UNSUPPORTED.map((item) => (
            <li key={item.label}>
              <div className="record static">
                <span className="record-main"><strong>{item.label}</strong></span>
                <p className="record-detail">{item.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function DataHubEmpty() {
  return <Empty title="Nothing imported yet">Upload a CSV to give a turbine its operational history.</Empty>;
}
