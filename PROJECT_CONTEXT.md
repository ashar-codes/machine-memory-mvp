

## Generation failover — 2026-09-10

Groq (`openai/gpt-oss-120b`) was added as a secondary text-generation provider so the copilot keeps
producing real synthesis when Gemini's free-tier quota is spent. Verified live: Gemini answered,
then hit quota mid-regression and Groq took over transparently with citations still resolving.

Gemini remains the sole embedding provider and no data was re-embedded — 21/21 chunks still report
one dimension variant (1536) and one embedding model (`gemini-embedding-001`). Schema, RAG
architecture and the API contract are unchanged; `provider.ts` is a composite `LlmClient`, so no
existing call site was modified.
