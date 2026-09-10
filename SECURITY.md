# Security invariants and review

This is a no-login, loopback-only university prototype. Backend startup must refuse public bind and production mode until an authentication/authorization design is implemented. RLS alone does not protect an unauthenticated privileged Express API. A shared/public deployment needs identity, authorization, TLS and durable quotas first.

- Browser talks to `/api` only. No Gemini key, DB password, Supabase service_role or secret key in frontend/VITE variables, logs or archive.
- Backend checks Host/Origin, uses Helmet, JSON limits, strict Zod, AI rate limits, generic error responses/request IDs. Reverse proxy trust stays disabled. CLI tools are trusted operator tools, not public endpoints.
- Supabase tables RLS-enabled, no anon/authenticated policies/grants. Privileged `pg` connection required; remote TLS certificate verification remains enabled. Prefer project-specific restricted DB credentials after infrastructure setup; postgres is migration/admin only for production.
- SQL is developer-written with bound values. No model SQL, eval, shell tools, remote ingestion URLs or machine-control endpoints.
- Resolution origin set by server; validated=true is a demo assertion, not permission or real technical validation. Append-only API does not guarantee immutable rows against the database owner; least-privilege runtime DB role is a deployment follow-up.
- Retrieved content is untrusted. No evidence-based prompt can override application rules. Citation allowlist, grounding checks and authoritative applicability required. Regex safety guard is a conservative foundation, not comprehensive industrial safety certification; adversarial paraphrase tests are mandatory before operational use.
- Unsafe bypass/protection/isolation/energized requests get REFUSED; absent authoritative support for procedures or numeric values gets INSUFFICIENT. Demo narratives never support execution instructions.
- No confidential Zephyr records. Origins visible in API, UI, fixtures and evidence; public source license/coverage retained. No confidential data sent to the model provider in this phase.

## Verification gates

Run lint/typecheck/tests/build; dependency audit when registry permits; DB checks on a dedicated new project for RLS, privileges, FK cross-asset isolation, vector dimensions, duplicate seed behavior and transactions. Test unknown citations, synthetic-only strength cap, unsafe intent disguise, invalid bodies, blocked origins, invalid UUID relations and sanitized failures. Record unrun gates explicitly in PROJECT_CONTEXT.md. Package pins are a reproducibility baseline, not a claim of vulnerability-free dependencies.

## Model provider: Gemini free tier

This prototype uses Google Gemini through a Google AI Studio free-tier API key. What that means concretely, stated without overclaiming:

- Content that leaves this machine for Google: reviewed **public** OSHA and NREL reference excerpts at ingestion time, and, at question time, the normalized evidence bundle — which contains **synthetic demonstration** maintenance data (the Demonstration Wind Farm, WT-07, `PITCH-HYD-214`), public Penmanshiel turbine identity fields, technician-entered `user_demo` resolution text, and the user's own question.
- No confidential Zephyr records and no E-SET production data are used anywhere in this project, so none can reach the provider.
- Free-tier terms differ from paid/commercial terms, including with respect to whether submitted content may be used to improve Google's products and how long it is retained. This configuration is chosen for a university prototype on public and fictional data. **It must not be assumed appropriate for confidential or commercial deployment.**
- Any production version needs its own commercial agreement, data-processing and privacy review, retention decision and residency decision before real plant data is submitted to any model provider. That review has not been done and is not implied by anything in this repository.
- The provider is a synthesis layer only. It receives an evidence bundle, never a database handle, never SQL, and no tools. Safety refusal, evidence strength and citation validity are decided by the backend before and after the model runs, so provider-side filtering is never the control that matters here.

## Dynamic ingestion (v2)

Users can now onboard turbines, import history and index technical documents at runtime. The
boundaries that make that safe:

- **Uploads never touch disk.** Files are parsed in memory, so there is no temporary file and no
  user-influenced path. Filenames are reduced to a display-only basename and used for provenance
  only. Extension, magic bytes and size are all validated; a mismatch is refused with a message
  describing the rule, never the file's contents. No shell execution, no model-chosen destinations.
- **Spreadsheet formulas are never evaluated.** Cells beginning `=`, `+`, `-` or `@` are stored
  prefixed so they cannot become live formulas if the data is re-exported.
- **The model cannot reach the database.** Column-mapping suggestions are validated against a frozen
  per-import-type field allowlist; a suggestion naming a table, a column outside that list, or SQL
  is discarded. The user confirms the mapping, and a hand-edited mapping from the browser passes
  through the same gate. Fleet questions select one of five predefined operations with bounded
  parameters, which backend code maps to parameterized SQL. No LLM-generated SQL is ever executed.
- **Uploaded knowledge is evidence, not authority.** `user_import` documents are stored UNVERIFIED,
  a database CHECK prevents them claiming REGULATOR or RESEARCH standing, and `procedural` still
  requires a public origin. An uploaded file is cited, but can never satisfy the
  authoritative-reference gate or license a procedure, numeric limit or isolation sequence.
- **Injected faults stay visibly injected.** Scenario Lab events carry `simulation` provenance in
  the database and are labelled wherever they appear. They are never presented as real telemetry.
- **Conversation cannot loosen safety.** Copilot history is bounded to 6 turns and 600 characters
  each; a resolved follow-up is re-scanned by the same deterministic guard, so context can add
  meaning but never authority.
- New tables (`data_sources`, `import_batches`) are RLS-enabled with no anon/authenticated grants,
  matching the foundation tables. The backend remains the only privileged path.

Unchanged: loopback-only binding, no authentication, no production mode. This remains a university
prototype and is not authorized for shared deployment.
