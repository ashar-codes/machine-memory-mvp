// The read-only operational-event boundary. No test here reaches a network, a provider or a PLC.
import { describe, expect, it, vi } from 'vitest';
import { recordEvent } from '../../backend/src/events.js';
import { investigate } from '../../backend/src/investigate.js';
import type { LlmClient } from '../../backend/src/llm.js';
import { createFailoverLlm } from '../../backend/src/provider.js';
import { UNSAFE_SUMMARY } from '../../backend/src/rag.js';
import {
  MAX_SIGNALS, SCENARIOS, SEVERITIES, SIMULATOR_SOURCE, findScenario,
  normalizedScadaEventSchema, toNormalizedEvent,
} from '../../backend/src/scada.js';
import { createSimulatorAdapter } from '../../backend/src/simulator.js';
import { createStreamHub, MAX_CLIENTS } from '../../backend/src/stream.js';
import { EVENT_CODE, createFakeDatabase } from './fakeDatabase.js';

const validEvent = {
  source: SIMULATOR_SOURCE,
  externalEventId: 'run-1:pitch_hydraulic:3',
  assetCode: 'WT-10',
  eventCode: 'PITCH-HYD-214',
  title: 'Pitch hydraulic pressure alert',
  subsystem: 'Pitch',
  severity: 'critical',
  occurredAt: '2026-09-10T20:41:23.000Z',
  description: 'Simulated demonstration alarm.',
  signalSnapshot: [{ label: 'Hydraulic pressure', value: 127, unit: 'bar' }],
};

/** Records queries and reports whether the asset exists and whether the insert was a duplicate. */
function fakeDb(options: { assetExists?: boolean; duplicate?: boolean } = {}) {
  const calls: { sql: string; values: unknown[] }[] = [];
  return {
    calls,
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values: values ?? [] });
      if (sql.includes('from public.assets where asset_code')) {
        return options.assetExists === false ? { rows: [], rowCount: 0 } : { rows: [{ id: 'asset-1' }], rowCount: 1 };
      }
      if (sql.includes('insert into public.asset_events')) {
        return options.duplicate ? { rows: [], rowCount: 0 } : { rows: [{ id: 'event-1', occurred_at: validEvent.occurredAt }], rowCount: 1 };
      }
      if (sql.includes('select') && sql.includes('where event_source =')) {
        return { rows: [{ id: 'existing-event', occurred_at: validEvent.occurredAt }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

describe('normalized event validation', () => {
  it('accepts a well-formed event', () => {
    const parsed = normalizedScadaEventSchema.parse(validEvent);
    expect(parsed.eventCode).toBe('PITCH-HYD-214');
    expect(parsed.signalSnapshot).toHaveLength(1);
  });

  it('rejects a severity outside the allowlist instead of coercing it', () => {
    for (const severity of ['CRITICAL', 'emergency', 'fatal', '', 'info ', 1, null]) {
      expect(() => normalizedScadaEventSchema.parse({ ...validEvent, severity })).toThrow();
    }
    for (const severity of SEVERITIES) {
      expect(normalizedScadaEventSchema.parse({ ...validEvent, severity }).severity).toBe(severity);
    }
  });

  it('rejects a malformed timestamp', () => {
    for (const occurredAt of ['not a date', '2026-13-45T00:00:00Z', '2026-09-10', '', 1757534483000]) {
      expect(() => normalizedScadaEventSchema.parse({ ...validEvent, occurredAt })).toThrow();
    }
  });

  it('rejects unsupported characters in an asset or event code', () => {
    expect(() => normalizedScadaEventSchema.parse({ ...validEvent, assetCode: "WT-10'; drop table assets;--" })).toThrow();
    expect(() => normalizedScadaEventSchema.parse({ ...validEvent, eventCode: 'A B' })).toThrow();
    expect(() => normalizedScadaEventSchema.parse({ ...validEvent, assetCode: 'x'.repeat(65) })).toThrow();
    expect(() => normalizedScadaEventSchema.parse({ ...validEvent, eventCode: 'x'.repeat(101) })).toThrow();
  });

  it('rejects unexpected properties, including prototype-pollution keys', () => {
    expect(() => normalizedScadaEventSchema.parse({ ...validEvent, command: 'stop' })).toThrow();
    expect(() => normalizedScadaEventSchema.parse({ ...validEvent, setpoint: 120 })).toThrow();
    expect(() => normalizedScadaEventSchema.parse({ ...validEvent, recordOrigin: 'public_data' })).toThrow();
    expect(() => normalizedScadaEventSchema.parse({ ...validEvent, __proto__: { polluted: true } })).toThrow();
    expect(() => normalizedScadaEventSchema.parse({ ...validEvent, constructor: 'x' })).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('bounds the signal snapshot', () => {
    const oversized = Array.from({ length: MAX_SIGNALS + 1 }, (_, i) => ({ label: `s${i}`, value: i, unit: 'x' }));
    expect(() => normalizedScadaEventSchema.parse({ ...validEvent, signalSnapshot: oversized })).toThrow();
    expect(() => normalizedScadaEventSchema.parse({ ...validEvent, signalSnapshot: [{ label: 'p', value: Number.NaN, unit: 'bar' }] })).toThrow();
    expect(normalizedScadaEventSchema.parse({ ...validEvent, signalSnapshot: undefined }).signalSnapshot).toEqual([]);
  });

  it('carries no field that could express a control command', () => {
    const fields = Object.keys(normalizedScadaEventSchema.parse(validEvent));
    for (const forbidden of ['command', 'setpoint', 'action', 'write', 'reset', 'acknowledge', 'override']) {
      expect(fields).not.toContain(forbidden);
    }
  });
});

describe('event persistence', () => {
  it('stores a simulator event with simulation provenance and its source identity', async () => {
    const db = fakeDb();
    const outcome = await recordEvent(db, {
      assetCode: 'WT-10', eventCode: 'PITCH-HYD-214', title: 'Alert', severity: 'critical',
      occurredAt: validEvent.occurredAt, recordOrigin: 'simulation',
      source: SIMULATOR_SOURCE, externalEventId: 'run-1:pitch:3',
    });
    expect(outcome.status).toBe('created');
    const insert = db.calls.find((call) => call.sql.includes('insert into public.asset_events'));
    expect(insert?.values).toContain('simulation');
    expect(insert?.values).toContain(SIMULATOR_SOURCE);
    expect(insert?.values).toContain('run-1:pitch:3');
    // Status recomputation must run through the same helper every other write path uses.
    expect(db.calls.some((call) => call.sql.includes('update public.assets a set status'))).toBe(true);
  });

  it('refuses an event for an asset that does not exist', async () => {
    const db = fakeDb({ assetExists: false });
    const outcome = await recordEvent(db, {
      assetCode: 'WT-NOPE', eventCode: 'X-1', title: 'Alert', severity: 'critical',
      occurredAt: validEvent.occurredAt, recordOrigin: 'simulation',
    });
    expect(outcome.status).toBe('asset_not_found');
    expect(db.calls.some((call) => call.sql.includes('insert into'))).toBe(false);
  });

  it('treats a replayed upstream event as a duplicate rather than new history', async () => {
    const db = fakeDb({ duplicate: true });
    const outcome = await recordEvent(db, {
      assetCode: 'WT-10', eventCode: 'PITCH-HYD-214', title: 'Alert', severity: 'critical',
      occurredAt: validEvent.occurredAt, recordOrigin: 'simulation',
      source: SIMULATOR_SOURCE, externalEventId: 'run-1:pitch:3',
    });
    expect(outcome.status).toBe('duplicate');
    // Idempotency is resolved by the index, not a read-then-write race.
    const insert = db.calls.find((call) => call.sql.includes('insert into public.asset_events'));
    expect(insert?.sql).toMatch(/on conflict \(event_source, external_event_id\)/);
    expect(insert?.sql).toMatch(/do nothing/);
  });

  it('lets a manual event through with no source identity, so it is never deduplicated', async () => {
    const db = fakeDb();
    await recordEvent(db, {
      assetCode: 'WT-10', eventCode: 'X-1', title: 'Manual', severity: 'warning',
      occurredAt: validEvent.occurredAt, recordOrigin: 'user_demo',
    });
    const insert = db.calls.find((call) => call.sql.includes('insert into public.asset_events'));
    expect(insert?.values.slice(-2)).toEqual([null, null]);
  });
});

describe('scenarios and the simulator adapter', () => {
  it('offers deterministic scenarios that all end in a critical event', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(3);
    for (const scenario of SCENARIOS) {
      expect(scenario.steps.at(-1)?.severity).toBe('critical');
      // Steps must be ordered, or the feed would appear to go backwards in time.
      const offsets = scenario.steps.map((step) => step.afterSeconds);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
      expect(scenario.steps.at(-1)!.afterSeconds).toBeLessThanOrEqual(25);
    }
    expect(findScenario('pitch_hydraulic')).toBeDefined();
    expect(findScenario('nope')).toBeUndefined();
  });

  it('emits events in order and keeps informational rows out of machine history', async () => {
    const emitted: string[] = [];
    const telemetry: string[] = [];
    const adapter = createSimulatorAdapter({ wait: async () => undefined });
    adapter.onEvent((event) => emitted.push(`${event.severity}:${event.eventCode}`));
    await adapter.run({ scenarioId: 'pitch_hydraulic', assetCode: 'WT-10', runId: 'run-1', onTelemetry: (row) => telemetry.push(row.title) });
    expect(emitted).toEqual(['warning:HYD-PRES-WARN', 'critical:PITCH-HYD-214']);
    expect(telemetry.length).toBeGreaterThan(0);
  });

  it('derives a stable external id, so replaying a run cannot duplicate history', async () => {
    const ids: string[][] = [];
    for (const attempt of [0, 1]) {
      const seen: string[] = [];
      const adapter = createSimulatorAdapter({ wait: async () => undefined });
      adapter.onEvent((event) => seen.push(event.externalEventId));
      await adapter.run({ scenarioId: 'pitch_hydraulic', assetCode: 'WT-10', runId: 'run-fixed' });
      ids[attempt] = seen;
    }
    expect(ids[0]).toEqual(ids[1]);
    expect(new Set(ids[0]).size).toBe(ids[0].length);
  });

  it('gives a genuinely new run genuinely new identities', async () => {
    const collect = async (runId: string) => {
      const seen: string[] = [];
      const adapter = createSimulatorAdapter({ wait: async () => undefined });
      adapter.onEvent((event) => seen.push(event.externalEventId));
      await adapter.run({ scenarioId: 'pitch_hydraulic', assetCode: 'WT-10', runId });
      return seen;
    };
    expect(await collect('run-a')).not.toEqual(await collect('run-b'));
  });

  it('stops a run in flight, keeping whatever was already delivered', async () => {
    const seen: string[] = [];
    // Cancel from inside the wait between steps, which is where a real stop lands.
    const adapter = createSimulatorAdapter({
      wait: async () => { if (seen.length >= 1) adapter.stop(); },
    });
    adapter.onEvent((event) => seen.push(event.eventCode));
    await adapter.run({ scenarioId: 'pitch_hydraulic', assetCode: 'WT-10', runId: 'r' });
    // The warning was delivered; the critical alarm after the cancel was not.
    expect(seen).toEqual(['HYD-PRES-WARN']);
    expect(adapter.isRunning()).toBe(false);
  });

  it('starts cleanly again after a stop, rather than staying cancelled', async () => {
    const adapter = createSimulatorAdapter({ wait: async () => undefined });
    const seen: string[] = [];
    adapter.onEvent((event) => seen.push(event.eventCode));
    adapter.stop();
    await adapter.run({ scenarioId: 'pitch_hydraulic', assetCode: 'WT-10', runId: 'r' });
    expect(seen).toEqual(['HYD-PRES-WARN', 'PITCH-HYD-214']);
  });

  it('rejects an unknown scenario', async () => {
    const adapter = createSimulatorAdapter({ wait: async () => undefined });
    await expect(adapter.run({ scenarioId: 'nope', assetCode: 'WT-10' })).rejects.toThrow();
  });

  it('stamps every simulated event with the simulator source', () => {
    const scenario = findScenario('gearbox_temperature')!;
    const step = scenario.steps.find((item) => item.kind === 'event')!;
    const event = toNormalizedEvent(step, { runId: 'r', scenarioId: scenario.id, index: 1, assetCode: 'WT-10', occurredAt: validEvent.occurredAt });
    expect(event?.source).toBe(SIMULATOR_SOURCE);
    // Informational rows produce no event at all.
    expect(toNormalizedEvent(scenario.steps[0], { runId: 'r', scenarioId: scenario.id, index: 0, assetCode: 'WT-10', occurredAt: validEvent.occurredAt })).toBeNull();
  });
});

describe('event stream hub', () => {
  const fakeResponse = () => {
    const frames: string[] = [];
    const handlers: Record<string, () => void> = {};
    return {
      frames, handlers,
      writeHead: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn(),
      write: (frame: string) => { frames.push(frame); return true; },
      on: (name: string, handler: () => void) => { handlers[name] = handler; },
    };
  };

  it('delivers events to every subscriber in order', () => {
    const hub = createStreamHub();
    const a = fakeResponse(); const b = fakeResponse();
    hub.subscribe(a as never); hub.subscribe(b as never);
    hub.publish({ type: 'event', payload: { eventCode: 'PITCH-HYD-214' } });
    hub.publish({ type: 'run', payload: { status: 'finished' } });
    for (const client of [a, b]) {
      const body = client.frames.join('');
      expect(body).toMatch(/event: event\ndata: {"eventCode":"PITCH-HYD-214"}/);
      expect(body.indexOf('PITCH-HYD-214')).toBeLessThan(body.indexOf('finished'));
    }
    hub.close();
  });

  it('drops a subscriber that has gone away, and bounds how many it holds', () => {
    const hub = createStreamHub();
    const client = fakeResponse();
    hub.subscribe(client as never);
    expect(hub.clientCount()).toBe(1);
    client.handlers.close();
    expect(hub.clientCount()).toBe(0);

    for (let i = 0; i < MAX_CLIENTS + 3; i += 1) hub.subscribe(fakeResponse() as never);
    expect(hub.clientCount()).toBeLessThanOrEqual(MAX_CLIENTS);
    hub.close();
  });
});

describe('investigation of an ingested event', () => {
  const goodAnswer = JSON.stringify({
    summary: 'Two previous occurrences are recorded.',
    findings: [{ title: 'Recurrence', detail: 'Recorded before.', citationIds: ['EV-1'] }],
    uncertainties: [],
  });
  const llmOf = (synthesize: () => Promise<unknown>): LlmClient => ({
    embed: async () => new Array(1536).fill(0.01), synthesize, structured: async () => null,
  });
  const httpError = (status: number) => Object.assign(new Error('api'), { status });

  const run = async (llm: LlmClient | null) => {
    const outcome = await investigate(
      { assetCode: 'WT-07', eventCode: EVENT_CODE, intent: 'GENERAL', question: `A critical ${EVENT_CODE} event was just recorded on WT-07. What does this machine's memory show about it?` },
      { db: createFakeDatabase(), llm },
    );
    if (outcome.status !== 'ok') throw new Error(outcome.status);
    return outcome.response;
  };

  it('runs the existing pipeline, with no SCADA-specific retrieval path', async () => {
    const response = await run(llmOf(async () => goodAnswer));
    expect(response.answer.summary).toBe('Two previous occurrences are recorded.');
    expect(response.evidence.length).toBeGreaterThan(0);
    expect(response.answer.findings[0].citationIds).toEqual(['EV-1']);
  });

  it('still answers when Gemini fails and Groq takes over', async () => {
    const llm = createFailoverLlm({
      gemini: llmOf(async () => { throw httpError(429); }),
      groq: { synthesize: async () => goodAnswer, structured: async () => null },
    });
    const response = await run(llm);
    expect(response.answer.summary).toBe('Two previous occurrences are recorded.');
  });

  it('still answers deterministically when both providers are down', async () => {
    const llm = createFailoverLlm({
      gemini: llmOf(async () => { throw httpError(429); }),
      groq: { synthesize: async () => { throw httpError(503); }, structured: async () => null },
    });
    const response = await run(llm);
    expect(response.answer.summary).toBeTruthy();
    expect(response.answer.findings.every((finding) => finding.citationIds.length > 0)).toBe(true);
  });

  it('keeps the safety layer authoritative for an ingested event', async () => {
    const outcome = await investigate(
      { assetCode: 'WT-07', eventCode: EVENT_CODE, intent: 'GENERAL', question: 'Can I bypass the pressure protection and keep the turbine running?' },
      { db: createFakeDatabase(), llm: llmOf(async () => JSON.stringify({ summary: 'Here is how', findings: [], uncertainties: [] })) },
    );
    if (outcome.status !== 'ok') throw new Error(outcome.status);
    expect(outcome.response.answer.safetyStatus).toBe('REFUSED');
    expect(outcome.response.answer.summary).toBe(UNSAFE_SUMMARY);
  });
});

describe('persistence is independent of AI availability', () => {
  it('records the event before any investigation is attempted', async () => {
    // recordEvent takes no LlmClient at all: an event cannot be lost to a provider outage,
    // because persistence has no dependency on one to lose.
    const db = fakeDb();
    const outcome = await recordEvent(db, {
      assetCode: 'WT-10', eventCode: 'PITCH-HYD-214', title: 'Alert', severity: 'critical',
      occurredAt: validEvent.occurredAt, recordOrigin: 'simulation',
      source: SIMULATOR_SOURCE, externalEventId: 'run-x:pitch:3',
    });
    expect(outcome.status).toBe('created');
    expect(recordEvent.length).toBe(2);
  });
});
