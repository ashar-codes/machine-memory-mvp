

## Secondary generation provider (v2.1)

- `GROQ_API_KEY` is backend-only, never a `VITE_` variable, and never reaches the browser. The
  frontend contains no reference to either provider key.
- Groq is a **generation** provider only. It never embeds, never queries PostgreSQL, never
  generates SQL, and receives no tools — the same bounded evidence bundle Gemini receives, fenced
  and labelled as data.
- The deterministic safety gate runs before any provider is called, so a REFUSED request is refused
  without a generation call at all. A provider that tried to answer an unsafe question could not
  reach one.
- Citation validation is provider-independent: a citation Groq invents is stripped exactly as one
  Gemini invents, and an answer whose citations do not resolve is replaced by the deterministic
  answer.
- Provider diagnostics log a provider name and a normalized failure reason (`quota exhausted`,
  `model unavailable`, `transport failure`). The provider's own error body is never logged, so a
  key or prompt echoed in an upstream error cannot reach a log line.
- `AI_GENERATION_PROVIDER` is a backend environment variable for testing failover. It is not an
  unauthenticated runtime setting and is not exposed through the API.
