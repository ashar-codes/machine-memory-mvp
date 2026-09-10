import { useState } from 'react';
import type { Asset, AssetEvent } from '@machine-memory/shared';
import { failureText, post } from './api';

/**
 * Onboarding and fault injection. A simulated fault is stored with simulation provenance and is
 * labelled as such everywhere it appears, so an injected event can never be mistaken for telemetry.
 */
export function ScenarioLab({ assets, onAssetCreated, onEventCreated }: {
  assets: Asset[];
  onAssetCreated: (asset: Asset) => void;
  onEventCreated: (assetCode: string) => void;
}) {
  return (
    <div className="page">
      <div className="page-head">
        <h2>Scenario Lab</h2>
        <p>
          Onboard a turbine, then give it a fault. A new asset starts with an empty machine memory —
          that is the point: you can watch it learn.
        </p>
      </div>
      <AddTurbine onCreated={onAssetCreated} />
      <AddEvent assets={assets} onCreated={onEventCreated} />
    </div>
  );
}

function AddTurbine({ onCreated }: { onCreated: (asset: Asset) => void }) {
  const [assetCode, setAssetCode] = useState('');
  const [siteName, setSiteName] = useState('Demonstration Wind Farm');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [ratedPowerKw, setRatedPowerKw] = useState('');
  const [commissionedOn, setCommissionedOn] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const submit = async () => {
    if (!assetCode.trim() || !siteName.trim()) { setError('An asset code and a site are required.'); return; }
    setBusy(true); setError(''); setDone('');
    try {
      const body: Record<string, unknown> = { assetCode: assetCode.trim(), siteName: siteName.trim() };
      if (manufacturer.trim()) body.manufacturer = manufacturer.trim();
      if (model.trim()) body.model = model.trim();
      if (serialNumber.trim()) body.serialNumber = serialNumber.trim();
      if (ratedPowerKw.trim()) body.ratedPowerKw = Number(ratedPowerKw);
      if (commissionedOn.trim()) body.commissionedOn = commissionedOn.trim();
      if (description.trim()) body.description = description.trim();
      const created = await post<{ asset: Asset }>('/assets', body);
      setDone(`${created.asset.assetCode} created with an empty machine memory.`);
      setAssetCode(''); setSerialNumber(''); setRatedPowerKw(''); setCommissionedOn(''); setDescription('');
      onCreated(created.asset);
    } catch (cause) {
      setError(failureText(cause) || 'The turbine could not be created.');
    } finally { setBusy(false); }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Add turbine</h3>
        <span className="panel-note">Created through the backend and stored as user import provenance.</span>
      </div>
      <div className="form-grid">
        <label>Asset code *<input value={assetCode} maxLength={64} placeholder="WT-10" onChange={(event) => setAssetCode(event.target.value)} /></label>
        <label>Site *<input value={siteName} maxLength={200} onChange={(event) => setSiteName(event.target.value)} /></label>
        <label>Manufacturer<input value={manufacturer} maxLength={200} placeholder="Fictional Demo OEM" onChange={(event) => setManufacturer(event.target.value)} /></label>
        <label>Model<input value={model} maxLength={200} placeholder="Demo 2MW" onChange={(event) => setModel(event.target.value)} /></label>
        <label>Serial number<input value={serialNumber} maxLength={200} onChange={(event) => setSerialNumber(event.target.value)} /></label>
        <label>Rated power (kW)<input value={ratedPowerKw} inputMode="numeric" onChange={(event) => setRatedPowerKw(event.target.value.replace(/[^0-9]/g, ''))} /></label>
        <label>Commissioned<input type="date" value={commissionedOn} onChange={(event) => setCommissionedOn(event.target.value)} /></label>
        <label className="wide">Description<input value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} /></label>
      </div>
      {error && <p className="turn-error">{error}</p>}
      {done && <p className="notice success-note">{done}</p>}
      <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Creating…' : 'Add turbine'}
      </button>
    </section>
  );
}

function AddEvent({ assets, onCreated }: { assets: Asset[]; onCreated: (assetCode: string) => void }) {
  const [assetCode, setAssetCode] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [title, setTitle] = useState('');
  const [subsystem, setSubsystem] = useState('');
  const [severity, setSeverity] = useState<'critical' | 'warning' | 'info'>('warning');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [description, setDescription] = useState('');
  const [simulation, setSimulation] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const submit = async () => {
    if (!assetCode || !eventCode.trim() || !title.trim()) { setError('Asset, event code and title are required.'); return; }
    setBusy(true); setError(''); setDone('');
    try {
      const body: Record<string, unknown> = {
        assetCode, eventCode: eventCode.trim(), title: title.trim(), severity,
        occurredAt: new Date(occurredAt).toISOString(), simulation,
      };
      if (subsystem.trim()) body.subsystem = subsystem.trim();
      if (description.trim()) body.description = description.trim();
      const created = await post<{ event: AssetEvent }>('/events', body);
      setDone(`${created.event.eventCode} recorded on ${assetCode} as ${created.event.recordOrigin}. Investigate it from Machine Memory.`);
      setEventCode(''); setTitle(''); setSubsystem(''); setDescription('');
      onCreated(assetCode);
    } catch (cause) {
      setError(failureText(cause) || 'The event could not be recorded.');
    } finally { setBusy(false); }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Add event / fault</h3>
        <span className="panel-note">A simulated fault is stored as simulation provenance and labelled everywhere it appears.</span>
      </div>
      <div className="form-grid">
        <label>Asset *
          <select value={assetCode} onChange={(event) => setAssetCode(event.target.value)}>
            <option value="">— choose a turbine —</option>
            {assets.map((asset) => <option key={asset.assetCode} value={asset.assetCode}>{asset.assetCode}</option>)}
          </select>
        </label>
        <label>Event code *<input value={eventCode} maxLength={100} placeholder="GEAR-TMP-402" onChange={(event) => setEventCode(event.target.value)} /></label>
        <label className="wide">Title *<input value={title} maxLength={500} placeholder="Gearbox oil temperature high" onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Subsystem<input value={subsystem} maxLength={200} placeholder="Gearbox" onChange={(event) => setSubsystem(event.target.value)} /></label>
        <label>Severity
          <select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}>
            <option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option>
          </select>
        </label>
        <label>Occurred at<input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
        <label className="wide">Observed symptoms<input value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} /></label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={simulation} onChange={(event) => setSimulation(event.target.checked)} />
        Simulation mode — this fault is injected for demonstration and is not real telemetry
      </label>
      {!simulation && (
        <p className="blocking">
          Unticked, this is recorded as a user-entered event rather than a simulation. Only untick it
          if a person genuinely observed this fault.
        </p>
      )}
      {error && <p className="turn-error">{error}</p>}
      {done && <p className="notice success-note">{done}</p>}
      <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Recording…' : 'Record event'}
      </button>
    </section>
  );
}
