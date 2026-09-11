import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import type pg from 'pg';
import type { ScadaEventPayload } from '@machine-memory/shared';
import type { AddressInfo } from 'node:net';
import { createScadaRoutes } from '../../backend/src/scadaRoutes.js';

const stored = { id: 'stored-id', asset_id: 'asset-a', asset_code: 'WT-07', event_code: 'STORED-1',
  title: 'Stored title', subsystem: 'Pitch', severity: 'warning', occurred_at: '2026-09-10T00:00:00.000Z',
  description: 'Stored description', record_origin: 'simulation', event_source: 'test-replay', external_event_id: 'same-id' };

describe('SCADA replay response and stream integrity', () => {
  it.each([false, true])('uses persisted fields when duplicate=%s', async (duplicate) => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from public.assets where asset_code')) return { rows: [{ id: 'asset-a' }] };
      if (sql.includes('insert into public.asset_events')) return { rows: duplicate ? [] : [stored] };
      if (sql.includes('event_source =')) return { rows: [stored] };
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = { connect: async () => ({ query, release }) } as unknown as pg.Pool;
    const publish = vi.fn(); const onCriticalEvent = vi.fn();
    const hub = { publish, subscribe: () => () => undefined, clientCount: () => 0, close: () => undefined };
    const app = express().use(createScadaRoutes({ pool, queryable: () => ({ query }), hub, onCriticalEvent }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const input = { source: 'test-replay', externalEventId: 'same-id', assetCode: 'WT-02', eventCode: 'CHANGED-2',
        title: 'Changed title', subsystem: 'Gearbox', severity: 'critical', occurredAt: '2026-09-11T00:00:00.000Z',
        description: 'Changed description', signalSnapshot: [{ label: 'unpersisted', value: 123, unit: 'x' }] };
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/scada/ingest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      expect(response.status).toBe(duplicate ? 200 : 201);
      const { event } = await response.json() as { event: ScadaEventPayload };
      expect(event).toEqual({ id: stored.id, assetCode: duplicate ? stored.asset_code : input.assetCode,
        eventCode: stored.event_code, title: stored.title, subsystem: stored.subsystem, severity: stored.severity,
        occurredAt: stored.occurred_at, description: stored.description, recordOrigin: stored.record_origin,
        source: stored.event_source, externalEventId: stored.external_event_id, duplicate,
        signalSnapshot: duplicate ? [] : input.signalSnapshot });
      expect(publish).toHaveBeenCalledWith({ type: 'event', payload: event });
      expect(onCriticalEvent).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledOnce();
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
