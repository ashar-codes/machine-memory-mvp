

## Demo C — a fault that arrives on its own

Run after Demo B, so WT-10 already has imported history and an indexed document. Reset with
`npm run demo:reset -- --include-imports` first if you are starting fresh, then re-run Demo B.

Opening line: *"So far every fault got here because a person typed it or uploaded it. Now let's
have one arrive on its own."*

1. **SCADA Simulator.** Read the header out loud, because it is the honest framing and it is more
   impressive than overclaiming: *Machine Memory is not connected to live industrial SCADA. This
   feed is simulated. Events enter through the same normalized read-only boundary a future
   historian or SCADA adapter would use — and once an event arrives, the investigation is real.*
2. Point at **read-only · no control channel**. There is no endpoint in this application that sends
   anything to a turbine. That is a design property, not a policy.
3. Select **WT-10** and **Gearbox temperature fault**, press **Start simulation**.
4. The feed streams: NORMAL (feed only) → GBX-TEMP-WARN (recorded) → NORMAL → **GEAR-TMP-402
   CRITICAL** (recorded). Informational rows never become machine history; warnings and faults do.
5. **New fault detected** appears, badged SIMULATION, with the simulated signals — say plainly that
   these are illustrative values, not OEM thresholds, and that they are never cited as evidence.
   *The alarm declares the fault; the RAG pipeline investigates it. It does not pretend to have
   discovered a physical threshold.*
6. **Machine Memory investigation** runs automatically. It finds the prior GEAR-TMP-402 occurrences
   imported in Demo B, the work orders, the uploaded gearbox document and the public OSHA/NREL
   corpus — evidence spanning three provenance classes at once.
7. **Fleet.** WT-10 is now faulted, and GEAR-TMP-402 appears under recurring faults with mixed
   `simulation` and `user_import` provenance shown honestly.

Closing line: *"The same investigation ran whether the fault was typed in, imported from a CSV, or
delivered by an operational feed. That is the point: the memory belongs to the machine, not to the
route the event took to get here."*
