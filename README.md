

## SCADA simulator

Machine Memory is **not connected to live industrial SCADA**. The SCADA Simulator page replays
deterministic demonstration scenarios through the same normalized read-only boundary a future
historian or SCADA adapter would use. Once an event arrives, the investigation is real.

Select an asset and a scenario, press Start, and a fault streams in over Server-Sent Events:
normal → warning → critical in about 13 seconds. The critical event is persisted with `simulation`
provenance, the asset's status updates, the timeline and fleet counts follow, and Machine Memory
investigates it automatically using the ordinary pipeline — no SCADA-specific retrieval path.

There is no control channel. No endpoint in this application sends anything to equipment.
`docs/SCADA_INTEGRATION.md` explains the boundary, the future-adapter interface, and why reacting
to an alarm is a different problem from raw-signal anomaly detection.
