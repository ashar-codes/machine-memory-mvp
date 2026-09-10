# Dynamic demonstration files

Fictional files for the Dynamic Machine Memory demonstration (`DEMO_SCRIPT.md`, Demo B). They exist
so a turbine can be onboarded and taught live, in front of an audience, without depending on a
network download.

**Everything in this folder is invented.** None of it is operational data, none of it is OEM
documentation, and the "Demo Wind OEM" reference is not a real manufacturer or a real manual. Once
imported, every row and passage carries `user_import` provenance and is labelled as such throughout
the interface. The uploaded document is stored `UNVERIFIED` and can never act as procedural
authority — see `docs/DYNAMIC_INGESTION.md`.

| File | Import as | What it demonstrates |
| --- | --- | --- |
| `wt10_events.csv` | Event / fault log | Deliberately unfamiliar headers (`Turbine_ID`, `Alarm_Code`, `Raised`, `Observed`) so the AI mapping step has real work to do. Contains three `GEAR-TMP-402` occurrences, so recurrence is computable straight after import. |
| `wt10_maintenance.csv` | Maintenance history | `Work Performed`, `Part Touched`, `Date Done` — another export dialect. Gives WT-10 a change history. |
| `wt10_work_orders.csv` | Work orders | Recorded causes and outcomes, so "How was it solved previously?" has something to retrieve. |
| `gearbox_thermal_note.txt` | Knowledge Base document | Chunked, embedded and citable immediately. Written to answer a question the public OSHA/NREL corpus cannot. |

The files pair with `WT-10`, which the presenter creates in Scenario Lab. Import in the order above.
