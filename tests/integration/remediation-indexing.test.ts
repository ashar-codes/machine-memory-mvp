import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../backend/src/app.js';

const resolution = { assetCode: 'WT-07', eventCode: 'TEST-1', rootCause: 'Recorded cause', resolutionSummary: 'Recorded outcome',
  component: 'Pitch', downtimeMinutes: 1, notes: '', validated: false };

describe('detached resolution indexing failures', () => {
  it.each(['connect', 'query', 'embedding', 'shutdown'])('retains structured save and contains %s failure', async (failure) => {
    const savedRelease = vi.fn(); const indexRelease = vi.fn();
    const statements: string[] = [];
    const savedClient = { release: savedRelease, query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT id, asset_type')) return { rows: [{ id: 'asset', asset_type: 'wind_turbine', manufacturer: null, model: null }] };
      if (sql.includes('INSERT INTO public.resolutions')) return { rows: [{ id: 'resolution', created_at: new Date() }] };
      return { rows: [] };
    } };
    const indexClient = { release: indexRelease, query: async () => { throw new Error('private database detail'); } };
    const connect = vi.fn().mockResolvedValueOnce(savedClient);
    if (failure === 'connect' || failure === 'shutdown') connect.mockRejectedValue(new Error('private connection detail'));
    else connect.mockResolvedValue(indexClient);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const llm = { synthesize: async () => null, embed: async () => {
      if (failure === 'embedding') throw new Error('private provider timeout');
      return new Array<number>(1536).fill(0.01);
    } };
    const server = createApp({ pool: { connect, query: async () => ({ rows: [] }) } as unknown as pg.Pool, llm }).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/resolutions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resolution),
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ memoryStatus: 'STRUCTURED_SAVED_SEMANTIC_PENDING', resolution: { id: 'resolution' } });
      await vi.waitFor(() => expect(warning).toHaveBeenCalledWith('Resolution saved; semantic indexing failed. Structured retrieval is unaffected.'));
      expect(statements).toContain('COMMIT'); expect(statements).not.toContain('ROLLBACK');
      expect(savedRelease).toHaveBeenCalledOnce();
      expect(indexRelease).toHaveBeenCalledTimes(['connect', 'shutdown'].includes(failure) ? 0 : 1);
      expect(warning.mock.calls.flat().join(' ')).not.toContain('private');
    } finally {
      warning.mockRestore(); server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
