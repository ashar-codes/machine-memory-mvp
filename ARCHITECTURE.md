

## Operational-event boundary (v2.2)

```
SimulatorScadaAdapter ─▶ NormalizedScadaEvent ─▶ recordEvent() ─▶ asset_events
                                                        │
                                          SSE feed ◀────┴──▶ investigate()  (best-effort)
```

`recordEvent()` in `backend/src/events.ts` is the single write path for an asset event. Manual
entry, CSV import and the operational boundary all use it, so a fault is stored, provenanced and
reflected in asset status identically whatever delivered it. `POST /api/events` was refactored onto
it rather than left as a parallel insert.

The boundary is one-directional by construction: the normalized schema is a strict object with no
field that can express a command, and `ScadaAdapter` has `connect`, `disconnect` and `onEvent` and
no write method. A future OPC UA, MQTT or historian adapter produces the same normalized event and
nothing downstream changes.

Real-time delivery is Server-Sent Events. One-directional, plain HTTP through the existing Vite
proxy and Host/Origin checks, no broker and no extra dependency.

Persistence never depends on AI: the event is committed, then investigated best-effort through the
existing Gemini → Groq → deterministic chain.
