// The HTTP surface of the read-only operational-event boundary.
//
// Everything here is inbound. There is no route that sends anything to a turbine: no start, stop,
// reset, acknowledge, override or setpoint. Machine Memory reads operational events and writes
// nothing back to industrial equipment, by construction rather than by policy.
import express, { type Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { ScadaEventPayload, ScadaStatus } from '@machine-memory/shared';
import { recordEvent, eventFields } from './events.js';
import type { LlmClient } from './llm.js';
import type { Queryable } from './retrieval.js';
import { normalizedScadaEventSchema, SCENARIOS, SIMULATOR_SOURCE, findScenario, type NormalizedScadaEvent } from './scada.js';
import { createSimulatorAdapter, type SimulatorAdapter } from './simulator.js';
import type { StreamHub } from './stream.js';

export class ScadaError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const startBody = z.strictObject({
  scenarioId: z.string().trim().min(1).max(64),
  assetCode: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  speed: z.enum(['1x', 'fast']).default('1x'),
});

export interface ScadaDeps {
  pool?: pg.Pool;
  llm?: LlmClient | null;
  queryable: (client: pg.Pool | pg.PoolClient) => Queryable;
  hub: StreamHub;
  adapter?: SimulatorAdapter;
  /** Best-effort investigation kicked off after a critical event is safely persisted. */
  onCriticalEvent?: (event: ScadaEventPayload) => void;
}

function toPayload(row: Record<string, unknown>, event: NormalizedScadaEvent, duplicate: boolean): ScadaEventPayload {
  if (row.record_origin !== 'simulation') throw new ScadaError(409, 'EVENT_IDENTITY_CONFLICT', 'This source identity belongs to a different record origin.');
  return {
    id: String(row.id), assetCode: String(row.asset_code), eventCode: String(row.event_code), title: String(row.title),
    subsystem: (row.subsystem as string | null) ?? null, severity: row.severity as ScadaEventPayload['severity'],
    occurredAt: new Date(row.occurred_at as string).toISOString(),
    description: (row.description as string | null) ?? null,
    recordOrigin: 'simulation', source: String(row.event_source), externalEventId: String(row.external_event_id),
    duplicate,
    // Carried on the wire for the feed only. Never stored as evidence, never embedded, never cited.
    signalSnapshot: duplicate ? [] : event.signalSnapshot,
  };
}

export function createScadaRoutes(deps: ScadaDeps): Router {
  const router = express.Router();
  const adapter = deps.adapter ?? createSimulatorAdapter();
  const db = () => {
    if (!deps.pool) throw new ScadaError(503, 'DATABASE_NOT_CONFIGURED', 'Configure DATABASE_URL and apply the schema.');
    return deps.pool;
  };
  // Ingest is cheap but must not be a way to flood the database from a loopback script.
  const ingestLimit = rateLimit({
    windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, _res, next) => next(new ScadaError(429, 'RATE_LIMITED', 'Too many operational events.')),
  });

  /**
   * Persists one normalized event through the shared event path.
   *
   * Persistence is deliberately independent of AI availability: the event is committed first, and
   * only then is an investigation offered. An unavailable model provider must never cost us an
   * incoming fault.
   */
  async function ingest(event: NormalizedScadaEvent): Promise<ScadaEventPayload> {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const outcome = await recordEvent(deps.queryable(client), {
        assetCode: event.assetCode, eventCode: event.eventCode, title: event.title,
        subsystem: event.subsystem ?? null, severity: event.severity,
        occurredAt: event.occurredAt, clearedAt: event.clearedAt ?? null,
        description: event.description ?? null,
        // Every event from this boundary is simulated, and says so in the database.
        recordOrigin: 'simulation', source: event.source, externalEventId: event.externalEventId,
      });
      if (outcome.status === 'asset_not_found') {
        await client.query('ROLLBACK');
        throw new ScadaError(404, 'ASSET_NOT_FOUND', `No asset "${event.assetCode}" exists. Onboard it before streaming events to it.`);
      }
      const payload = toPayload(outcome.event, event, outcome.status === 'duplicate');
      await client.query('COMMIT');
      deps.hub.publish({ type: 'event', payload: payload as unknown as Record<string, unknown> });
      // A replay must not re-trigger an investigation any more than it re-creates the row.
      if (payload.severity === 'critical' && !payload.duplicate) deps.onCriticalEvent?.(payload);
      return payload;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  adapter.onEvent((event) => {
    void ingest(event).catch(() => {
      // The run continues: one rejected event must not abort the rest of the feed.
      deps.hub.publish({ type: 'run', payload: { runId: 'unknown', scenarioId: '', assetCode: event.assetCode, status: 'failed' } });
    });
  });

  router.get('/api/scada/status', async (_req, res) => {
    let recentEvents: ScadaEventPayload[] = [];
    if (deps.pool) {
      const result = await deps.pool.query(
        `select ${eventFields('e')}, a.asset_code from public.asset_events e
           join public.assets a on a.id = e.asset_id
          where e.event_source = $1 order by e.occurred_at desc, e.id desc limit 20`, [SIMULATOR_SOURCE]);
      recentEvents = result.rows.map((row) => ({
        id: String(row.id), assetCode: String(row.asset_code), eventCode: String(row.event_code),
        title: String(row.title), subsystem: (row.subsystem as string | null) ?? null,
        severity: row.severity as ScadaEventPayload['severity'],
        occurredAt: new Date(row.occurred_at as string).toISOString(),
        description: (row.description as string | null) ?? null,
        recordOrigin: 'simulation', source: String(row.event_source),
        externalEventId: String(row.external_event_id ?? ''), duplicate: false, signalSnapshot: [],
      }));
    }
    const status: ScadaStatus = {
      connected: true,
      // Always true. There is no configuration in which this becomes a real SCADA connection.
      simulated: true,
      source: SIMULATOR_SOURCE,
      running: adapter.isRunning(),
      scenarios: SCENARIOS.map((scenario) => ({
        id: scenario.id, name: scenario.name, summary: scenario.summary,
        steps: scenario.steps.length,
        durationSeconds: scenario.steps.at(-1)?.afterSeconds ?? 0,
      })),
      recentEvents,
    };
    res.json(status);
  });

  router.get('/api/scada/stream', (_req, res) => { deps.hub.subscribe(res); });

  router.post('/api/scada/simulate', express.json({ limit: '8kb', strict: true }), async (req, res) => {
    const input = startBody.parse(req.body);
    const scenario = findScenario(input.scenarioId);
    if (!scenario) throw new ScadaError(404, 'SCENARIO_NOT_FOUND', 'Unknown scenario.');
    if (adapter.isRunning()) throw new ScadaError(409, 'RUN_IN_PROGRESS', 'A simulation run is already in progress.');
    const asset = await db().query('select 1 from public.assets where asset_code = $1', [input.assetCode]);
    if (!asset.rowCount) throw new ScadaError(404, 'ASSET_NOT_FOUND', 'Asset not found. Onboard the turbine first.');

    const runId = randomUUID();
    deps.hub.publish({ type: 'run', payload: { runId, scenarioId: scenario.id, assetCode: input.assetCode, status: 'started' } });
    // The run continues in the background so the request returns immediately; the browser follows
    // it on the event stream rather than holding a long request open.
    void adapter.run({
      runId, scenarioId: scenario.id, assetCode: input.assetCode, speed: input.speed,
      onTelemetry: (row) => deps.hub.publish({ type: 'telemetry', payload: row as unknown as Record<string, unknown> }),
      onStep: (progress) => deps.hub.publish({
        type: 'run',
        payload: { runId, scenarioId: scenario.id, assetCode: input.assetCode, status: 'started', step: progress.index + 1, total: progress.total },
      }),
    })
      .then(() => deps.hub.publish({ type: 'run', payload: { runId, scenarioId: scenario.id, assetCode: input.assetCode, status: 'finished' } }))
      .catch(() => deps.hub.publish({ type: 'run', payload: { runId, scenarioId: scenario.id, assetCode: input.assetCode, status: 'failed' } }));

    res.status(202).json({ runId, scenarioId: scenario.id, assetCode: input.assetCode, status: 'started' });
  });

  // Named for what it stops: the simulation run. In an industrial context a bare "stop" endpoint
  // reads like a turbine command, and no endpoint here commands anything.
  router.post('/api/scada/simulation/stop', express.json({ limit: '1kb', strict: true }), (_req, res) => {
    adapter.stop();
    deps.hub.publish({ type: 'run', payload: { runId: '', scenarioId: '', assetCode: '', status: 'stopped' } });
    res.json({ status: 'stopped' });
  });

  /**
   * The adapter-facing ingestion endpoint. A future OPC UA or historian adapter would post the
   * same normalized shape here. It accepts events only — there is no command channel.
   */
  router.post('/api/scada/ingest', ingestLimit, express.json({ limit: '16kb', strict: true }), async (req, res) => {
    const event = normalizedScadaEventSchema.parse(req.body);
    const payload = await ingest(event);
    res.status(payload.duplicate ? 200 : 201).json({ event: payload });
  });

  return router;
}
