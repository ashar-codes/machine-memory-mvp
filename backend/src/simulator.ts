// The simulator adapter, and the runner that schedules a scenario.
//
// This is the only ScadaAdapter that exists. It fabricates events on a fixed timetable; it does
// not read from anything. Every event it produces is persisted with record_origin 'simulation'.
import { randomUUID } from 'node:crypto';
import {
  findScenario, SIMULATOR_SOURCE, toNormalizedEvent,
  type NormalizedScadaEvent, type Scenario, type ScadaAdapter, type ScenarioStep,
} from './scada.js';

export const SPEEDS = { '1x': 1, fast: 3 } as const;
export type SpeedName = keyof typeof SPEEDS;

export interface SimulatorAdapter extends ScadaAdapter {
  /** Emits one scenario. Resolves when the last step has been delivered. */
  run(options: RunOptions): Promise<void>;
  /** Stops an in-flight run. Anything already persisted stays persisted. */
  stop(): void;
  isRunning(): boolean;
}

export interface RunOptions {
  scenarioId: string;
  assetCode: string;
  speed?: SpeedName;
  runId?: string;
  /** Informational rows: shown in the feed, never written to machine history. */
  onTelemetry?: (row: TelemetryRow) => void;
  onStep?: (progress: { index: number; total: number; step: ScenarioStep }) => void;
}

export interface TelemetryRow {
  runId: string;
  assetCode: string;
  title: string;
  severity: string;
  occurredAt: string;
  signalSnapshot: { label: string; value: number; unit: string }[];
}

// Deliberately NOT unref'd. An unref'd timer tells Node not to stay alive for it, but a pending
// scenario step is real work: with unref the run silently stalled between steps whenever nothing
// else happened to be holding the event loop open.
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * `now` and `wait` are injected so tests can run a whole scenario instantly and deterministically
 * without touching the clock.
 */
export interface SimulatorDeps { now?: () => Date; wait?: (ms: number) => Promise<void> }

export function createSimulatorAdapter(deps: SimulatorDeps = {}): SimulatorAdapter {
  const now = deps.now ?? (() => new Date());
  const wait = deps.wait ?? sleep;
  const listeners = new Set<(event: NormalizedScadaEvent) => void>();
  let connected = false;
  let cancelled = false;
  let running = false;

  const emit = (event: NormalizedScadaEvent) => {
    for (const listener of listeners) listener(event);
  };

  return {
    source: SIMULATOR_SOURCE,

    async connect() { connected = true; },
    async disconnect() { cancelled = true; connected = false; listeners.clear(); },

    onEvent(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    isRunning: () => running,
    stop() { cancelled = true; },

    async run(options) {
      const scenario: Scenario | undefined = findScenario(options.scenarioId);
      if (!scenario) throw new Error('Unknown scenario.');
      if (!connected) await this.connect();
      if (running) throw new Error('A simulation run is already in progress.');

      const runId = options.runId ?? randomUUID();
      const divisor = SPEEDS[options.speed ?? '1x'];
      running = true;
      cancelled = false;
      let elapsed = 0;
      try {
        for (const [index, step] of scenario.steps.entries()) {
          const delay = Math.max(0, (step.afterSeconds * 1000) / divisor - elapsed);
          if (delay > 0) await wait(delay);
          elapsed = (step.afterSeconds * 1000) / divisor;
          if (cancelled) return;

          options.onStep?.({ index, total: scenario.steps.length, step });
          const occurredAt = now().toISOString();

          if (step.kind === 'telemetry') {
            options.onTelemetry?.({
              runId, assetCode: options.assetCode, title: step.title, severity: step.severity,
              occurredAt, signalSnapshot: step.signalSnapshot ?? [],
            });
            continue;
          }
          const event = toNormalizedEvent(step, { runId, scenarioId: scenario.id, index, assetCode: options.assetCode, occurredAt });
          if (event) emit(event);
        }
      } finally {
        running = false;
      }
    },
  };
}
