# Agent ownership and parallel handoff

Contracts frozen v1, 2026-09-09. Architect owns root docs, shared types and integration package lock. Implementation agents must not casually edit each other's directories. Report a contract blocker with exact proposed delta; architect coordinates before implementation resumes.

| Agent / branch | Owns | Exact next task and acceptance |
| --- | --- | --- |
| Infrastructure / agent/infrastructure | supabase/, DB environment keys in coordination with architect | Create/select a dedicated Machine Memory Supabase project; apply migration; verify all RLS/grants/vector/FK constraints and rerunnable seed; hand backend tested connection contract without committing secrets. Do not reuse E-Set Permit DB. |
| Data/RAG / agent/data-rag | scripts/, data/, offline knowledge ingestion | Acquire bounded Penmanshiel subset with license/coverage, implement inspected CSV mappings, ingest reviewed OSHA/NREL excerpts, verify embeddings/filtering/idempotency. Coordinate DB retrieval interface with backend. |
| Backend / agent/backend | backend/ | Implement intent SQL aggregates + metadata-filtered vectors + evidence fusion + Responses schema + citation/grounding validation; connect deterministic strength; implement resolution semantic reindex retries. Test current fault excluded from prior count and SQL counts unaffected by page limits. |
| Frontend / agent/frontend | frontend/ | Build investigation panel, cited evidence/source/provenance viewer, intent controls, fleet history and resolution entry against frozen types; refresh timeline and label semantic pending; never imply fake data is live. |
| QA / agent/qa | tests/integration/ | After integration verify API/database end-to-end, exact counts vs fixtures, cross-asset compatibility, unsafe prompt refusals, invalid citations, persistence/restart and memory retrieval. Narrow cross-project fixes only after owners finish. |
| Architect / main | docs/, root documentation/config, packages/shared/ | Maintain contracts, resolve blockers, integrate lockfile, review security, record verified checkpoints. |

Data/RAG must NOT edit backend ingestion code independently. Propose interface or send patch to Backend owner. Root lockfile dependency edits serialize through architect; no concurrent npm installs. QA owns tests/integration only while owners work.

## Git Bash workflow (Windows compatible)

After extracting archive, `git init -b main`, `git add .`, `git commit -m "chore: freeze machine memory foundation"`. If already cloned, use existing Git repository and start from its current reviewed checkpoint.

From repository root:

```bash
git worktree add ../mm-infrastructure -b agent/infrastructure main
git worktree add ../mm-data-rag -b agent/data-rag main
git worktree add ../mm-backend -b agent/backend main
git worktree add ../mm-frontend -b agent/frontend main
```

Each agent opens its own directory in VS Code, runs `npm ci`, copies root `.env.example` into local `.env`, and edits only its ownership. Never share untracked secrets through commits. Let the architect install/refresh the lockfile when manifests change. Each owner verifies its code and commits. Merge Infrastructure first, then Data/RAG, Backend, Frontend, resolving genuine interface changes explicitly. Root runs complete verification after each merge. Create QA worktree from the integrated main: `git worktree add ../mm-qa -b agent/qa main`. QA changes integration tests, then reports narrowly scoped fixes for merged main.

## 2–3 hour implementation budget after foundation

0–15 min: Infrastructure establishes new DB/key configuration while all agents read contracts. 15–75 min: schema/seed+references, retrieval/synthesis and UI run in parallel. 75–110 min: merge and connect; prioritize one complete WT-07 investigation/save/requery path. 110–150 min: QA and evidence/safety/provenance corrections. 150–180 min buffer/demo rehearsal. Real data or credentials can block this schedule; synthetic fixtures are the honest interim fallback. Never claim a complete RAG demo if only SQL/bootstrap is working.
