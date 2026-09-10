// The read-only operational-event boundary.
//
// Machine Memory currently has NO connection to live industrial SCADA. This module defines the
// normalized shape an event would arrive in, and ships exactly one adapter: a simulator that
// replays deterministic demonstration scenarios.
//
// The boundary is one-directional by construction. There is no command, no write-back, no
// setpoint, no acknowledge, no reset — nothing in this file or anywhere downstream can send
// anything to a turbine. Events flow in; nothing flows out.
//
// A future deployment would add another adapter (an OPC UA client, a historian REST poller, an
// MQTT subscriber) that produces the same NormalizedScadaEvent. Everything after this boundary
// stays unchanged, which is the point of normalizing here.
import { z } from 'zod';

export const SIMULATOR_SOURCE = 'scada_simulator';
export const MAX_SIGNALS = 12;
/** Severities the schema accepts. Anything else is rejected, never coerced into 'info'. */
export const SEVERITIES = ['info', 'warning', 'critical'] as const;

/**
 * A signal reading shown alongside a simulated alarm.
 *
 * These are illustrative demonstration values. They are NOT OEM thresholds, and nothing in the
 * pipeline treats them as evidence: they are not embedded, not retrieved and not cited. The alarm
 * declares the fault; the signals are context for a human reading the feed.
 */
export const signalSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  value: z.number().finite(),
  unit: z.string().trim().max(20),
});

export const normalizedScadaEventSchema = z.strictObject({
  source: z.string().trim().min(1).max(64),
  externalEventId: z.string().trim().min(1).max(200),
  assetCode: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  eventCode: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  title: z.string().trim().min(1).max(500),
  subsystem: z.string().trim().min(1).max(200).nullish(),
  severity: z.enum(SEVERITIES),
  occurredAt: z.string().trim().datetime({ offset: true }),
  clearedAt: z.string().trim().datetime({ offset: true }).nullish(),
  description: z.string().trim().max(4000).nullish(),
  signalSnapshot: z.array(signalSchema).max(MAX_SIGNALS).default([]),
});

export type NormalizedScadaEvent = z.infer<typeof normalizedScadaEventSchema>;

/**
 * What a future real adapter would implement. Read-only by design: it can be connected to, listened
 * to, and disconnected from. It has no method that writes anything to the source.
 */
export interface ScadaAdapter {
  readonly source: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Registers a listener for inbound events. Returns an unsubscribe function. */
  onEvent(listener: (event: NormalizedScadaEvent) => void): () => void;
}

export interface ScenarioStep {
  /** Seconds after the run starts, at 1x speed. */
  afterSeconds: number;
  /** An informational heartbeat is shown in the feed but never persisted as machine history. */
  kind: 'telemetry' | 'event';
  eventCode?: string;
  title: string;
  subsystem?: string;
  severity: typeof SEVERITIES[number];
  description?: string;
  signalSnapshot?: { label: string; value: number; unit: string }[];
}

export interface Scenario {
  id: string;
  name: string;
  summary: string;
  steps: ScenarioStep[];
}

/**
 * Deterministic demonstration scenarios. Every code here is a fictional demonstration code, not a
 * manufacturer fault definition, and the descriptions say so. Sequences are fixed, not random, so
 * a rehearsal and the live run behave identically.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'pitch_hydraulic',
    name: 'Pitch hydraulic fault',
    summary: 'Normal telemetry, a pitch hydraulic pressure warning, then a critical PITCH-HYD-214 alarm.',
    steps: [
      { afterSeconds: 0, kind: 'telemetry', title: 'Normal operation', severity: 'info',
        signalSnapshot: [
          { label: 'Hydraulic pressure', value: 186, unit: 'bar' },
          { label: 'Oil temperature', value: 47, unit: '°C' },
          { label: 'Rotor speed', value: 14.2, unit: 'rpm' },
          { label: 'Wind speed', value: 11.4, unit: 'm/s' },
        ] },
      { afterSeconds: 4, kind: 'event', eventCode: 'HYD-PRES-WARN', title: 'Pitch hydraulic pressure below normal band',
        subsystem: 'Pitch', severity: 'warning',
        description: 'Simulated demonstration alarm. Pressure drifted below the simulated normal band.',
        signalSnapshot: [
          { label: 'Hydraulic pressure', value: 158, unit: 'bar' },
          { label: 'Oil temperature', value: 52, unit: '°C' },
          { label: 'Rotor speed', value: 13.8, unit: 'rpm' },
        ] },
      { afterSeconds: 9, kind: 'telemetry', title: 'Pressure continuing to fall', severity: 'info',
        signalSnapshot: [{ label: 'Hydraulic pressure', value: 141, unit: 'bar' }] },
      { afterSeconds: 13, kind: 'event', eventCode: 'PITCH-HYD-214', title: 'Pitch hydraulic pressure alert',
        subsystem: 'Pitch', severity: 'critical',
        description: 'Simulated demonstration alarm raised by the SCADA simulator. The alarm declares the fault; no threshold in this system is an approved OEM limit.',
        signalSnapshot: [
          { label: 'Hydraulic pressure', value: 127, unit: 'bar' },
          { label: 'Oil temperature', value: 58, unit: '°C' },
          { label: 'Rotor speed', value: 9.1, unit: 'rpm' },
          { label: 'Wind speed', value: 12.0, unit: 'm/s' },
        ] },
    ],
  },
  {
    id: 'gearbox_temperature',
    name: 'Gearbox temperature fault',
    // Raises GEAR-TMP-402 deliberately: that is the code the demonstration event log in
    // data/demo/wt10_events.csv already contains, so a simulated fault on WT-10 lands on a machine
    // that has real imported history and an indexed technical document to retrieve. Pairing a
    // scenario with a code the asset has never seen makes an honest but pointless demonstration.
    summary: 'Normal telemetry, an elevated gearbox oil temperature warning, then a critical GEAR-TMP-402 alarm. Pairs with the WT-10 demonstration import.',
    steps: [
      { afterSeconds: 0, kind: 'telemetry', title: 'Normal operation', severity: 'info',
        signalSnapshot: [
          { label: 'Gearbox oil temperature', value: 62, unit: '°C' },
          { label: 'Cooler fan state', value: 1, unit: 'on/off' },
          { label: 'Wind speed', value: 10.8, unit: 'm/s' },
        ] },
      { afterSeconds: 4, kind: 'event', eventCode: 'GBX-TEMP-WARN', title: 'Gearbox oil temperature elevated',
        subsystem: 'Gearbox', severity: 'warning',
        description: 'Simulated demonstration alarm. Oil temperature rising above the simulated normal band.',
        signalSnapshot: [
          { label: 'Gearbox oil temperature', value: 78, unit: '°C' },
          { label: 'Cooler fan state', value: 1, unit: 'on/off' },
        ] },
      { afterSeconds: 9, kind: 'telemetry', title: 'Temperature still rising', severity: 'info',
        signalSnapshot: [{ label: 'Gearbox oil temperature', value: 84, unit: '°C' }] },
      { afterSeconds: 13, kind: 'event', eventCode: 'GEAR-TMP-402', title: 'Gearbox oil temperature high',
        subsystem: 'Gearbox', severity: 'critical',
        description: 'Simulated demonstration alarm raised by the SCADA simulator. Fictional demonstration code, not a manufacturer fault definition.',
        signalSnapshot: [
          { label: 'Gearbox oil temperature', value: 91, unit: '°C' },
          { label: 'Cooler fan state', value: 0, unit: 'on/off' },
          { label: 'Rotor speed', value: 8.4, unit: 'rpm' },
        ] },
    ],
  },
  {
    id: 'converter_temperature',
    name: 'Converter temperature fault',
    summary: 'Normal telemetry, a converter temperature warning, then a critical CNV-TEMP-455 alarm.',
    steps: [
      { afterSeconds: 0, kind: 'telemetry', title: 'Normal operation', severity: 'info',
        signalSnapshot: [
          { label: 'Converter temperature', value: 55, unit: '°C' },
          { label: 'Active power', value: 1820, unit: 'kW' },
        ] },
      { afterSeconds: 4, kind: 'event', eventCode: 'CNV-TEMP-WARN', title: 'Converter temperature elevated',
        subsystem: 'Converter', severity: 'warning',
        description: 'Simulated demonstration alarm. Converter temperature above the simulated normal band.',
        signalSnapshot: [
          { label: 'Converter temperature', value: 71, unit: '°C' },
          { label: 'Active power', value: 1760, unit: 'kW' },
        ] },
      { afterSeconds: 9, kind: 'telemetry', title: 'Derating in progress', severity: 'info',
        signalSnapshot: [{ label: 'Active power', value: 1210, unit: 'kW' }] },
      { afterSeconds: 13, kind: 'event', eventCode: 'CNV-TEMP-455', title: 'Converter overtemperature',
        subsystem: 'Converter', severity: 'critical',
        description: 'Simulated demonstration alarm raised by the SCADA simulator. Fictional demonstration code, not a manufacturer fault definition.',
        signalSnapshot: [
          { label: 'Converter temperature', value: 86, unit: '°C' },
          { label: 'Active power', value: 640, unit: 'kW' },
        ] },
    ],
  },
];

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/**
 * Builds the normalized event for one scenario step.
 *
 * The external id is derived from the run, the scenario and the step index, so replaying the same
 * run is idempotent while a genuinely new run produces genuinely new events.
 */
export function toNormalizedEvent(
  step: ScenarioStep, options: { runId: string; scenarioId: string; index: number; assetCode: string; occurredAt: string },
): NormalizedScadaEvent | null {
  if (step.kind !== 'event' || !step.eventCode) return null;
  return normalizedScadaEventSchema.parse({
    source: SIMULATOR_SOURCE,
    externalEventId: `${options.runId}:${options.scenarioId}:${options.index}`,
    assetCode: options.assetCode,
    eventCode: step.eventCode,
    title: step.title,
    subsystem: step.subsystem ?? null,
    severity: step.severity,
    occurredAt: options.occurredAt,
    clearedAt: null,
    description: step.description ?? null,
    signalSnapshot: step.signalSnapshot ?? [],
  });
}
