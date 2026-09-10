

## Generation failover (v2.1)

```
Gemini ──failure──▶ Groq ──failure──▶ deterministic answer from retrieved evidence
```

`provider.ts` is a composite `LlmClient`, so nothing downstream changed: `investigate.ts`,
`copilot.ts` and `mapping.ts` already took an injected client and were not modified.

- **Gemini** — primary generation *and the sole embedding provider*.
- **Groq** (`openai/gpt-oss-120b`) — secondary **text generation only**.
- **Deterministic** — the existing grounded fallback, unchanged.

Failover triggers only when the primary *fails*: an exception, or a null/empty result. An answer
Gemini successfully produced is never re-rolled on Groq, because judging content and retrying
elsewhere would make the answer a matter of provider roulette. When Gemini succeeds Groq is not
called at all.

**Embeddings never fail over, and this is the important part.** The pgvector corpus was built with
`gemini-embedding-001`. Two embedding models do not share a vector space merely because they share
a dimension count — a 1536-dimension Groq vector scored against Gemini vectors would return
confident nonsense, silently, with no error anywhere. `GroqGenerator` therefore has no `embed`
method at all, and `embed` returns null rather than substituting a provider. Losing semantic
ranking is the safe failure; corrupting it is not.

Both providers receive the identical evidence bundle and the identical system instructions, and
both outputs pass through the same `parseModelAnswer` and the same citation validation. The
deterministic safety gate runs *before* either provider, so a refusal never reaches a model.
`AI_GENERATION_PROVIDER` (`auto` | `gemini` | `groq`) forces a provider for testing; it is a
backend environment variable, never a runtime setting.
