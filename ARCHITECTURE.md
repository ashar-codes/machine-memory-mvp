# Machine Memory architecture

Machine Memory: An Asset-Conditioned Retrieval-Augmented Generation (RAG) System for Wind Turbine Maintenance Intelligence.

## Scope and stack

First phase establishes a production-shaped **local university MVP foundation**, not production readiness. npm workspaces: React/Vite/TypeScript frontend, Express/TypeScript/Zod backend, type-only shared package. Supabase PostgreSQL + pgvector supplies persistent structured history and semantic evidence. Node `pg` uses parameterized SQL; no browser Supabase client. OpenAI Responses API is the designated synthesis provider (`gpt-5.6-terra`); `text-embedding-3-small` with1536 dimensions is fixed for ingestion. No orchestration framework, autonomous agents, container requirement or machine-control integrations.

The asset is the memory unit; schema supports future asset types. Demo uses a fictional wind farm. Penmanshiel may supply bounded public metadata/events later, without misrepresenting fictional maintenance as real history.

## Boundaries

Browser → backend → PostgreSQL. Backend → OpenAI for embeddings/synthesis only when configured and implemented. CLI ingestion → OpenAI embeddings → transactional PostgreSQL document/chunk insertion. Credentials stay server-side. Keep query/retrieval services in backend; data parsing and offline ingestion under scripts. Shared package contains wire types/constants only, no database/LLM implementation.

## Hybrid pipeline (implemented)

Implemented across `backend/src/retrieval.ts`, `evidence.ts`, `synthesis.ts`, `llm.ts` and `investigate.ts`. The numbered design below is what the code now does, with two deviations recorded at the end of this section.

1. Validate asset, optional event, intent and question; load selected asset from SQL. Apply deterministic unsafe-operation detection before normal synthesis; unsupported procedures/setpoints fail closed.
2. Intent selects developer-written SQL templates. SQL computes exact counts, coverage ranges, recent changes and recurrence. Store count as evidence with query scope/time range/provenance, not as model arithmetic. Same asset history and compatible fleet comparisons use separate queries.
3. Embed question once; filter document/chunk metadata by asset type, manufacturer and model before ranking1536-dimensional cosine distance. Exact current-asset narratives and compatible cross-asset narratives remain distinguishable. Null metadata means unspecified, not approved for every model. Do not use a fault-code string alone to equate different OEMs.
4. Fuse/deduplicate evidence using stable typed IDs such as `event:<uuid>`, `resolution:<uuid>`, `chunk:<uuid>`, `aggregate:<scope-hash>`. Preserve SQL facts as canonical; do not replace counts with truncated top-k results.
5. Authority: applicable OEM documentation for model-specific technical instructions; regulator for general safety; research for background; historical work orders/resolutions for reported past actions; user/synthetic assertions never elevate to technical authority. Conflicts produce uncertainty and block unsafe recommendations.
6. Run deterministic strength and safety gates. Pass only bounded evidence + fixed instructions to Responses API with `store:false`, no tools and JSON schema output. Retrieved documents are untrusted data; embedded instructions cannot change policy. Never execute returned SQL/code or let LLM select arbitrary tools.
7. Validate answer structure and every citation ID. Citation existence is necessary, **not proof a claim is supported**: check factual grounding, numeric values against authoritative excerpts, and reject uncited operational recommendations. Backend overwrites model confidence/safety fields. On failures, return insufficient evidence or sanitized provider error; no invented fallback facts.

### Deviations from the original design

**Evidence IDs are `EV-1`, `EV-2`, ... in presentation order, not typed UUIDs like `event:<uuid>`.** Short IDs are what a language model cites reliably and what a reader can scan in the evidence panel. They are stable within a single response only, and the contract now says so. The underlying record identity is preserved in the evidence title and timestamp.

**Ranking happens in TypeScript, not SQL.** The knowledge query returns a bounded candidate set with cosine similarity and keyword rank computed in PostgreSQL; the composite ordering — authority class, role for the intent, applicability, then similarity — is applied in `evidence.ts`. This keeps the authority rules readable and directly testable, and it is well within budget for a corpus of this size. Revisit if the corpus grows by orders of magnitude.

## New memory lifecycle

Resolution POST validates → locks/resolves asset in transaction → inserts user_demo resolution → commits → responds with STRUCTURED_SAVED_SEMANTIC_PENDING → the timeline refreshes and the record is immediately retrievable by structured retrieval.

Semantic indexing then runs as a separate best-effort step in `backend/src/memoryIndex.ts`, **after** the response has been sent. It embeds the resolution narrative and writes a `user_demo` document and chunk. Three properties matter: it cannot roll back the committed resolution; a failure is logged and nothing else; and success is never reported to the client, because the frozen status enum would then be claiming completion for work that may still be in flight. A retry sweep for previously failed indexing is not implemented and is recorded as open.

This is why the demonstration loop works even with no OpenAI key at all: structured retrieval finds the new resolution on the very next question, because it was committed to SQL, not because it was embedded.

## Integration interfaces

Wire contracts: docs/API_CONTRACT.md + packages/shared/src/index.ts. Schema: supabase/migrations. Seed format: docs/SEED_CONTRACT.md. Local knowledge manifests: docs/DATA_RAG_HANDOFF.md. These become authoritative before parallel implementation. No schema/type amendments without architect decision record and coordinated rebasing.

## Official model references

The requested model is documented with Responses support: https://developers.openai.com/api/docs/models/gpt-5.6-terra . Default embedding dimensions are documented at https://developers.openai.com/api/docs/guides/embeddings . Account access and live API calls remain unverified. No fine-tuning is required: RAG indexes evidence; it does not retrain model weights.
