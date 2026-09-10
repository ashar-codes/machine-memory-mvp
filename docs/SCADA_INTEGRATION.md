# Operational-event integration

## Machine Memory does not connect to live industrial SCADA

There is no OPC UA client, no Modbus, no MQTT, no historian connection and no vendor API in this
repository. What exists is a **simulator** that produces deterministic demonstration events, and the
normalized read-only boundary those events arrive through.

Say it this way, and no other way:

> "For the hackathon, Machine Memory uses a simulated SCADA event stream. The event enters through
> the same normalized read-only boundary intended for a future historian or SCADA adapter. Once the
> event arrives, the Machine Memory investigation pipeline is real."

Never say "connected to live SCADA."

## The boundary

```
adapter ──▶ NormalizedScadaEvent ──▶ recordEvent() ──▶ asset_events ──▶ existing investigation
```

`NormalizedScadaEvent` (`backend/src/scada.ts`) is a strict Zod object:

| Field | Notes |
| --- | --- |
| `source` | Which adapter delivered it |
| `externalEventId` | The upstream system's own id; used for idempotency |
| `assetCode`, `eventCode` | Identifier-shaped, validated by pattern and length |
| `title`, `subsystem`, `description` | Bounded text |
| `severity` | `info` \| `warning` \| `critical`, allowlisted — never coerced |
| `occurredAt`, `clearedAt` | ISO 8601 with offset |
| `signalSnapshot` | At most 12 finite readings, for display only |

Events reach the database through `recordEvent()` in `backend/src/events.ts` — the same function
manual entry uses. There is deliberately no second write path, so provenance and asset-status
handling cannot diverge between a hand-entered fault and an ingested one.

## Read-only, by construction

The boundary is one-directional because of what it *is*, not because of a rule written somewhere:

- The normalized schema is `strictObject`, and has no field that can express a command. A payload
  carrying `command`, `setpoint`, `action` or anything else unrecognised is rejected outright. A
  test asserts those field names cannot appear.
- There is no route anywhere in the application that writes toward equipment: no start, stop, reset,
  acknowledge, override or setpoint change.
- The adapter interface has `connect`, `disconnect` and `onEvent`. It has no method that writes.

```
SCADA / historian ──▶ Machine Memory        (this exists, simulated)
Machine Memory ──▶ turbine control          (does not exist, and must not)
```

## Future adapters

A real deployment would add another `ScadaAdapter` producing the same `NormalizedScadaEvent`:
an OPC UA client, a historian REST poller, an MQTT subscriber, or a vendor API client. Everything
downstream stays unchanged — that is the entire purpose of normalizing at this boundary.

No protocol libraries are installed, and none should be until there is a real system to connect to.

## Why this is not anomaly detection

Machine Memory reacts to an alarm the operational system already raised. It does not analyse raw
sensor streams and it does not predict failure.

- **Raw signal anomaly detection** is a time-series problem: thresholds, drift detection, spectral
  analysis, models trained on labelled telemetry. That is a different system.
- **Machine Memory** is a retrieval problem: given a fault that has been declared, what does this
  machine's recorded history, its fleet, and the reviewed technical corpus say about it?

The distinction matters for honesty. The simulated `signalSnapshot` values shown next to an alarm
are illustrative demonstration numbers. They are never embedded, never retrieved and never cited,
and the model is never told that a particular reading means failure. **The alarm declares the
fault; RAG investigates it.** Claiming otherwise would be claiming a capability this system does
not have.

## Idempotency

Industrial feeds resend. A partial unique index on `(event_source, external_event_id)` plus
`ON CONFLICT DO NOTHING` makes a replay return the stored row instead of creating a second copy —
enforced by the database rather than a read-then-write check that two deliveries could race. A
replay also does not re-trigger the automatic investigation.

## Availability

Persistence never depends on AI availability. `recordEvent()` takes no model client at all: the
event is committed, and only then is an investigation offered, best-effort, through the existing
Gemini → Groq → deterministic chain. An unavailable provider costs an analysis, never a fault.

## Scenarios

Three deterministic demonstration scenarios ship in `backend/src/scada.ts`: pitch hydraulic,
gearbox temperature and converter temperature. Each runs normal → warning → critical in about 13
seconds at 1x. Every code is a fictional demonstration code, not a manufacturer fault definition.

The gearbox scenario deliberately raises `GEAR-TMP-402`, the code the demonstration import in
`data/demo/wt10_events.csv` already contains, so a simulated fault on WT-10 lands on a machine that
has imported history and an indexed technical document to retrieve.

## Provenance

Everything from this boundary is stored `record_origin = 'simulation'` and badged SIMULATION in the
timeline, the fault panel, the investigation evidence and the fleet feed. A simulated event can
never be visually or programmatically confused with `public_data`, `public_reference`,
`synthetic_demo`, `user_import`, or with a future real SCADA feed.
