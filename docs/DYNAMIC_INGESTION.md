

## Generation providers

Generation fails over; embeddings do not.

| Role | Provider | Notes |
| --- | --- | --- |
| Embeddings | Gemini `gemini-embedding-001` **only** | No failover, ever. See below. |
| Generation, primary | Gemini `gemini-3.6-flash` | |
| Generation, secondary | Groq `openai/gpt-oss-120b` | Text only. Strict JSON schema for synthesis. |
| Generation, last resort | Deterministic | Grounded answer assembled from retrieved evidence. |

Embeddings are deliberately excluded from failover. Vectors from two different embedding models are
not interchangeable merely because they have the same number of dimensions: they occupy different
spaces, so a Groq vector compared against the stored `gemini-embedding-001` corpus would return
plausible-looking, confidently wrong neighbours — with no error to notice. If Gemini embedding is
unavailable, retrieval falls back to keyword ranking and says so, which is honest; silently mixing
vector spaces would not be.
