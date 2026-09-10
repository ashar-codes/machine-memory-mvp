# Deterministic evidence strength v1

Implementation: backend/src/rag.ts `scoreEvidence`, with signals derived in backend/src/evidence.ts `deriveSignals` and applied in backend/src/investigate.ts. It returns an ordinal evidence label, never a probability or machine safety authorization.

`onlyDemo` is computed against the evidence that actually carries the answer for the requested intent, not against everything retrieved. For HISTORY, PREVIOUS_RESOLUTION and SIMILAR_INCIDENTS that means the machine-history records; a general public safety page retrieved alongside them cannot lift synthetic history to HIGH.

**Known limitation:** `conflicting` is never set automatically in v1. No dependable deterministic contradiction test exists over free-text maintenance narratives, and a false positive would silently suppress a correct answer. Two synthetic incidents recording different causes for the same code are therefore treated as two records, not as a conflict. The signal remains part of the scoring contract for a future implementation and is covered by tests.

Signals must be derived from **retrieved supporting evidence**, not merely from a selected asset/event or the question text. With no evidence all positive flags are false. priorOccurrences is a nonnegative SQL integer from a defined coverage/time scope, excluding the current event; never count a limited top-k list. For mixed origins, structured aggregates must disclose counts per origin.

| Supporting signal | Points |
| --- | --- |
| Same asset history found | 1 |
| Exact event match found | 1 |
| One or more prior occurrences, from SQL | 1 |
| Linked resolution/work order | 1 |
| Compatible cross-asset corroboration | 1 |
| Applicable authoritative technical reference | 2 |
| Applicable authoritative safety reference | 2 |

Conflicting material evidence → INSUFFICIENT regardless of points. Otherwise <2 → INSUFFICIENT; 2–4 → MODERATE; ≥5 → HIGH unless all supporting evidence is synthetic_demo/user_demo, which caps at MODERATE. Signals must use evidence relevant to the answer's claims: adding an unrelated public safety page must not elevate synthetic machine history. If only demo facts support the substantive answer, onlyDemo remains true even when a general public warning is also present.

For technical/safety guidance, strength is subordinate to the safety gate: missing verified applicable instructions or numeric values → safetyStatus INSUFFICIENT even if historical evidence scores HIGH. Forbidden bypass/unsafe-operation requests → REFUSED. No number of historical incidents authorizes a procedure. validated=true in a user resolution never sets authoritativeTechnical/authoritativeSafety.

Unknown citation IDs and uncited findings fail validation. Citation validation is an allowlist check, not semantic entailment. Backend owner must implement full response-schema parsing, numeric/procedure grounding and source applicability before synthesis is enabled. This foundation does not claim those unfinished checks are complete.
