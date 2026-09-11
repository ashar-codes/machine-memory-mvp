import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { AddressInfo } from 'node:net';
import { budgetLlm, createWorkGate, withLazyClient, WorkLimitError } from '../../backend/src/work.js';
import { createStreamHub, MAX_FRAME_BYTES } from '../../backend/src/stream.js';
import { createApp } from '../../backend/src/app.js';
import { createFakeDatabase } from './fakeDatabase.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('local resource admission', () => {
  it('has no queue and recovers after both success and failure', async () => {
    const gate = createWorkGate(); const held = deferred<void>();
    const jobs = [gate.run(() => held.promise), gate.run(async () => { await held.promise; throw new Error('failed'); }).catch(() => undefined)];
    const rejected = vi.fn(async () => undefined);
    await expect(gate.run(rejected)).rejects.toBeInstanceOf(WorkLimitError);
    expect(rejected).not.toHaveBeenCalled(); expect(gate.active()).toBe(2);
    held.resolve(); await Promise.all(jobs);
    expect(gate.active()).toBe(0); await gate.run(rejected); expect(rejected).toHaveBeenCalledOnce();
  });
  it('shares lifetime allowance across all model operations and counts failed calls', async () => {
    const embed = vi.fn(async () => { throw new Error('failed'); });
    const synthesize = vi.fn(async () => 'answer'); const structured = vi.fn(async () => 'plan');
    const llm = budgetLlm({ embed, synthesize, structured }, 2)!;
    await expect(llm.embed('query')).rejects.toThrow();
    expect(await llm.structured!('instruction', {}, {})).toBe('plan');
    expect(await llm.embed('next')).toBeNull();
    expect(await llm.synthesize({} as never)).toBeNull();
    expect(embed).toHaveBeenCalledOnce(); expect(synthesize).not.toHaveBeenCalled();
  });
  it('holds no database client during provider waits and releases after SQL failure', async () => {
    const wait = deferred<void>(); const release = vi.fn();
    const connect = vi.fn(async () => ({ query: async () => { throw new Error('query failure'); }, release }));
    const task = withLazyClient({ connect } as unknown as pg.Pool, async (db) => { await wait.promise; return db.query('begin'); });
    expect(connect).not.toHaveBeenCalled(); wait.resolve();
    await expect(task).rejects.toThrow('query failure'); expect(connect).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  });
  it('keeps upload indexing out of the connection pool until embeddings finish', async () => {
    const wait = deferred<number[] | null>(); const embed = vi.fn(() => wait.promise);
    const release = vi.fn();
    const query = vi.fn(async () => ({ rows: [{ id: '00000000-0000-4000-8000-000000000001',
      title: 'Test', organization: 'Test', source_type: 'TECHNICAL_REFERENCE', authority_class: 'UNVERIFIED',
      record_origin: 'user_import', created_at: new Date(), chunks: 1, embedded_chunks: 0 }] }));
    const connect = vi.fn(async () => ({ query, release }));
    const server = createApp({ pool: { connect, query } as unknown as pg.Pool,
      llm: { embed, synthesize: async () => null } }).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const form = new FormData(); form.set('title', 'Test'); form.set('organization', 'Test');
    form.set('file', new Blob(['A turbine inspection narrative uploaded for testing. This is not an approved procedure.']), 'test.txt');
    const response = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/knowledge/upload`, { method: 'POST', body: form });
    try {
      await vi.waitFor(() => expect(embed).toHaveBeenCalledOnce());
      expect(connect).not.toHaveBeenCalled(); wait.resolve(null);
      expect((await response).status).toBe(201);
      expect(connect).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
    } finally { wait.resolve(null); await response; server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it('rejects excess HTTP work before parsing uploads, retains slots after disconnect, and recovers', async () => {
    const wait = deferred<number[] | null>();
    const embed = vi.fn(() => wait.promise);
    const db = createFakeDatabase();
    const server = createApp({ pool: db as unknown as pg.Pool, llm: { embed, synthesize: async () => null } }).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = (signal?: AbortSignal) => fetch(base + '/api/investigate', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetCode: 'WT-07', intent: 'HISTORY', question: 'What is the event history?' }) });
    const abort = new AbortController();
    const pending = [request(abort.signal).catch(() => null), request()];
    try {
      await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(2));
      abort.abort();
      const response = await fetch(base + '/api/knowledge/upload', { method: 'POST', body: 'not multipart' });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: 'WORK_CAPACITY_REACHED' } });
      expect(embed).toHaveBeenCalledTimes(2);
      wait.resolve(null); await Promise.all(pending);
      expect((await request()).status).toBe(200);
    } finally { wait.resolve(null); await Promise.all(pending); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});

describe('bounded stream buffers', () => {
  it('disconnects a backpressured client while delivering to a healthy one', () => {
    const hub = createStreamHub();
    const fake = () => ({ writeHead: vi.fn(), on: vi.fn(), destroy: vi.fn(), end: vi.fn(), write: vi.fn(() => true), writableLength: 0 });
    const slow = fake(); const healthy = fake();
    hub.subscribe(slow as never); hub.subscribe(healthy as never);
    slow.write.mockReturnValue(false);
    hub.publish({ type: 'event', payload: { id: 'test' } });
    expect(slow.destroy).toHaveBeenCalledOnce(); expect(hub.clientCount()).toBe(1);
    expect(healthy.write).toHaveBeenCalledTimes(2);
    hub.publish({ type: 'event', payload: { text: 'x'.repeat(MAX_FRAME_BYTES) } });
    expect(healthy.write).toHaveBeenCalledTimes(2);
    hub.close();
  });
  it('contains heartbeat write failure', () => {
    vi.useFakeTimers();
    const hub = createStreamHub();
    const response = { writeHead: vi.fn(), on: vi.fn(), destroy: vi.fn(), write: vi.fn(() => true) };
    try {
      hub.subscribe(response as never);
      response.write.mockImplementation(() => { throw new Error('broken pipe'); });
      expect(() => vi.advanceTimersByTime(25_000)).not.toThrow();
      expect(hub.clientCount()).toBe(0); expect(response.destroy).toHaveBeenCalledOnce();
    } finally { hub.close(); vi.useRealTimers(); }
  });
});
