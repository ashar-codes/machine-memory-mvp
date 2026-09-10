# Five-minute demonstration

## Before the room

```bash
npm run dev
```

Confirm both status lamps in the header. Database should read connected. If no Gemini key is set, the workspace shows a notice saying answers are assembled deterministically from retrieved evidence — that is a legitimate mode to present, not a failure, and it is worth saying so out loud rather than hiding it.

Select **WT-07** before anyone is watching so the first thing on screen is a turbine with an open fault.

---

**Step 1 — the premise (30s).** WT-07 is showing `PITCH-HYD-214`, a critical pitch hydraulic pressure alert. Point at the asset rail: every turbine carries its own memory. Say once, clearly, that this farm and all its maintenance history are synthetic demonstration data, and that the amber "Synthetic demo" badges on screen are how the system says so itself.

**Step 2 — "Has this happened before?" (40s).** Two previous occurrences on this asset, with timestamps, and the current one excluded from the count. Make the point that the number came from SQL, not from the language model: the model is handed the count and forbidden from recomputing it. Click a citation chip; the evidence panel scrolls to the exact record behind the claim.

**Step 3 — "How was it solved previously?" (45s).** A prior incident, a completed work order and a logged resolution. Every card is badged as a synthetic demonstration record, and the answer itself states that a past outcome is not an approved current procedure. This distinction is the whole reason the system is useful rather than dangerous.

**Step 4 — "What changed recently?" (30s).** A bounded 30-day window ending at the selected occurrence: a sensor replacement and a recent inspection. Note that the window is computed by the backend and stated in the answer, so nobody has to guess what "recently" meant.

**Step 5 — "Find similar fleet cases" (30s).** WT-03 recorded the same event code. The selected asset is excluded in SQL, and exact code matches are labelled separately from semantically similar narratives. Say why: the same code on a different manufacturer or model does not automatically mean the same fault.

**Step 6 — "Show technical guidance" (40s).** If the corpus is ingested, NREL/TP-5000-80195 comes back with its pitch bearing reliability section, blue-flagged as a public reference with a working source link. Say plainly what it is: published research about pitch bearings across the industry, not a Senvion procedure for this machine. If the corpus is not ingested, the system says the reference is unavailable and returns `INSUFFICIENT` — show that instead, and explain that refusing to answer is the correct behaviour.

**Step 7 — the safety question (45s).** Type: *Can I bypass the pressure protection and keep the turbine running?* The status chip turns red, `REFUSED`. No maintenance history is summarised alongside it — check the evidence panel: only safety references, if any are loaded. The refusal is deterministic and runs on the question text before retrieval, so relabelling it as a history question does not get past it.

**Step 8 — log a new resolution (45s).** Open **Log resolution**. Enter a root cause and outcome, name a component, set downtime, tick the confirmation. Save. The timeline updates, the new entry carries a violet "User demo" badge, and the banner says *Added to machine memory*. Point out that ticking the box records your assertion and grants no authority — the system says this in the form itself.

**Step 9 — the payoff (25s).** Click **How was it solved previously?** again. The resolution entered thirty seconds ago is now retrieved evidence with its own citation ID.

> "The machine has acquired a new retrievable memory, and no language model was retrained to do it."

---

## Questions you should expect

**Is it just a chatbot over documents?** No. Counts, timestamps, fleet matches and change windows come from parameterized SQL. The model receives a normalized evidence bundle and synthesizes it; it has no database access, generates no SQL, and cannot add a fact that is not in the bundle.

**What if it makes something up?** Every finding must cite evidence that exists in the response. Unknown citation IDs are stripped, findings left uncited are dropped, and if nothing survives the backend answers deterministically from the retrieved records instead. There is a test for exactly this.

**Why no confidence percentage?** Because it would be a fiction. Evidence strength describes the quality and coverage of what was retrieved, not the probability that the answer is right. Synthetic-only history is capped at `MODERATE` no matter how much of it there is.

**Is any of the data real?** The 14 Penmanshiel turbine identities are real public data under CC BY 4.0, verified against the publisher's checksum. The reference corpus is real OSHA and NREL material, paraphrased with attribution. Every fault, repair and narrative is synthetic and labelled as such. Nothing synthetic is dressed up as operational history.

## What not to claim

Do not present synthetic history as real plant data. Do not describe the reference corpus as ingested unless `npm run rag:ingest:corpus` actually reported success. Do not read a historical resolution aloud as if it were the approved fix. Do not call any of this equipment control.

## Demo B — Dynamic Machine Memory

The new demonstration. Files are in `data/demo/`; run `npm run demo:reset -- --include-imports`
beforehand so `WT-10` does not already exist.

Opening line: *"That was a machine the system already knew. Now watch it learn one it has never
seen."*

1. **Scenario Lab → Add turbine.** Asset code `WT-10`, site `Demonstration Wind Farm`, manufacturer
   `Fictional Demo OEM`, model `Demo 2MW`. Create it.
2. **Machine Memory → WT-10.** Empty. Ask the copilot anything and it says so plainly rather than
   guessing — that honesty is the point, and it is what makes the next step land.
3. **Data Hub → Event / fault log →** `data/demo/wt10_events.csv`. Pause on the mapping table: the
   headers are `Turbine_ID`, `Alarm_Code`, `Raised`, `Observed` — nothing like the internal field
   names. Show that required fields are marked, that a mapping can be corrected in the dropdown,
   and that the import is blocked until every required field is assigned. Import 4 rows.
4. **AI Copilot → asset scope →** *"Has this happened before?"* Three `GEAR-TMP-402` occurrences,
   two of them prior. **The count is computed in SQL, not by the model.**
5. **Data Hub → Work orders →** `data/demo/wt10_work_orders.csv`. Import.
6. **AI Copilot →** *"How was it solved previously?"* The recorded causes and outcomes come back,
   labelled as user-imported and explicitly not an approved procedure.
7. **Data Hub → Maintenance history →** `data/demo/wt10_maintenance.csv`, then ask *"What changed
   recently?"* — the change window is SQL-computed, and nothing claims causation.
8. **Knowledge Base → Index a technical document →** `data/demo/gearbox_thermal_note.txt`.
   Title it, upload, and watch it chunk, embed and report *Knowledge indexed successfully*.
9. **AI Copilot →** *"What does the technical reference say about gearbox oil cooler fouling on this
   platform?"* The new document appears in the citations — and the answer says it is unreviewed
   user-imported material, because uploading a file adds knowledge, never authority.
10. **Safety, on the new machine:** *"Can I bypass the gearbox temperature protection and keep
    running?"* Refused, with OSHA evidence, exactly as on WT-07.
11. **Fleet.** WT-10 now appears alongside WT-07 under recurring faults.

Closing line: *"Machine Memory learned an entirely new machine and its technical knowledge without
retraining Gemini. Nothing was fine-tuned. The turbine simply has a memory now."*

### If the model is unavailable

Free-tier quota is finite. If Gemini is rate-limited during the demo, answers still come back —
assembled deterministically from the retrieved evidence, with the same counts, the same citations
and the same refusals. Say so out loud: it demonstrates that the machine's memory lives in the
database, not in the model.
