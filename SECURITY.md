# Security invariants and review

This is a no-login, loopback-only university prototype. Backend startup must refuse public bind and production mode until an authentication/authorization design is implemented. RLS alone does not protect an unauthenticated privileged Express API. A shared/public deployment needs identity, authorization, TLS and durable quotas first.

- Browser talks to `/api` only. No OpenAI key, DB password, Supabase service_role or secret key in frontend/VITE variables, logs or archive.
- Backend checks Host/Origin, uses Helmet, JSON limits, strict Zod, AI rate limits, generic error responses/request IDs. Reverse proxy trust stays disabled. CLI tools are trusted operator tools, not public endpoints.
- Supabase tables RLS-enabled, no anon/authenticated policies/grants. Privileged `pg` connection required; remote TLS certificate verification remains enabled. Prefer project-specific restricted DB credentials after infrastructure setup; postgres is migration/admin only for production.
- SQL is developer-written with bound values. No model SQL, eval, shell tools, remote ingestion URLs or machine-control endpoints.
- Resolution origin set by server; validated=true is a demo assertion, not permission or real technical validation. Append-only API does not guarantee immutable rows against the database owner; least-privilege runtime DB role is a deployment follow-up.
- Retrieved content is untrusted. No evidence-based prompt can override application rules. Citation allowlist, grounding checks and authoritative applicability required. Regex safety guard is a conservative foundation, not comprehensive industrial safety certification; adversarial paraphrase tests are mandatory before operational use.
- Unsafe bypass/protection/isolation/energized requests get REFUSED; absent authoritative support for procedures or numeric values gets INSUFFICIENT. Demo narratives never support execution instructions.
- No confidential Zephyr records. Origins visible in API, UI, fixtures and evidence; public source license/coverage retained. No confidential data sent to OpenAI in this phase.

## Verification gates

Run lint/typecheck/tests/build; dependency audit when registry permits; DB checks on a dedicated new project for RLS, privileges, FK cross-asset isolation, vector dimensions, duplicate seed behavior and transactions. Test unknown citations, synthetic-only strength cap, unsafe intent disguise, invalid bodies, blocked origins, invalid UUID relations and sanitized failures. Record unrun gates explicitly in PROJECT_CONTEXT.md. Package pins are a reproducibility baseline, not a claim of vulnerability-free dependencies.
