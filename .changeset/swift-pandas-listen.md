---
'@opensaas/stack-rag': minor
---

Correct the RAG guidance's own usage examples so they compile against the real
signatures, and point the README at the examples that exist.

`chunkText`'s entry in the export list was corrected last round; its usage
example 439 lines below was not, and passed `maxTokens`/`overlap` — the
field-level `ChunkingConfig` names, not `ChunkingOptions`. It also fed the
returned `TextChunk[]` straight to `embedBatch(string[])`. Both now compile:

```typescript
const chunks = chunkText(longDocument, {
  strategy: 'recursive',
  chunkSize: 500,
  chunkOverlap: 50,
})

const vectors = await provider.embedBatch(chunks.map((chunk) => chunk.text))
```

Sweeping the rest of the file against the source turned up the same class in the
custom-provider example. `registerEmbeddingProvider`'s factory is handed the
whole `EmbeddingProviderConfig` union, whose custom member is an open
`{ type: string; [key: string]: unknown }`, so `config.model` arrives as
`unknown` and `config.dimensions` is absent from `OpenAIEmbeddingConfig`, so it
is not readable off the union. Reading them straight onto the returned
`EmbeddingProvider` was two type errors; the example now narrows both, and says
why:

```typescript
registerEmbeddingProvider('custom', (config) => {
  const model = typeof config.model === 'string' ? config.model : 'custom-embed'
  const dimensions =
    'dimensions' in config && typeof config.dimensions === 'number' ? config.dimensions : 768

  return {
    type: 'custom',
    model,
    dimensions,
    async embed(text) {
      return [/* vector */]
    },
    async embedBatch(texts) {
      return [[/* vectors */]]
    },
  }
})
```

The README's Examples section pointed at `examples/rag-demo`, which does not
exist, and credited it with MCP integration and multiple providers, which
neither real example has. It now names `examples/rag-ollama-demo` and
`examples/rag-openai-chatbot` and says what each actually demonstrates.

The sweep that found those was then run over every fenced TypeScript block in
the RAG guidance rather than the lines a grep implicated: each block compiled
against this branch's own built declarations, and each block that redeclares an
exported type checked for structural equivalence with the real one. That second
check is what caught the `EmbeddingProvider` interface documenting `embedBatch`
as optional when it is required — a block declaring its own copy of a type
compiles against that copy, so nothing else would have. Also corrected across
the guidance:

- The Cohere and HuggingFace factory registrations passed the config union
  straight into constructors typed `CohereConfig` / `HuggingFaceConfig`; both
  now narrow with the same `in` guard.
- The "internal provider registry" sketch invented a `Factory` type and
  constructed built-in providers off the un-narrowed union — the very defect
  corrected twenty lines below it. It is now the registry's real signature,
  with the reason narrowing is needed stated as prose.
- A retry loop read `lastError` before definite assignment and cast with `as
Error`; a monitoring example read `.message` off `unknown`; a cost table was
  indexed by a free `string`. All three now narrow properly.
- Blocks that used `createEmbeddingProvider`, `getContext`, `text`,
  `SearchResult` or `EmbeddingProvider` without importing them now import them.
- Multi-vector search annotated `nearest()`'s result as `SearchResult`; that is
  what `semanticSearch()` and `findSimilar()` return. `nearest()` returns
  `NearestMatch` from `@opensaas/stack-core`.
- The "Rate Limiting" recipe had the reader hand-write a `RateLimiter` class
  into `lib/rate-limiter.ts`. `RateLimiter` is already exported from
  `@opensaas/stack-rag/runtime` — a different shape under the same name, so
  following the guide collides with the package. The recipe is now the shipped
  class: `new RateLimiter(100)` and `await limiter.waitForSlot()`.
- The reference's `SearchResult` sketch wrote `SearchResult<T>` where the
  package declares `SearchResult<T = unknown>`, making the bare `SearchResult`
  the reference uses elsewhere an arity error the package does not have.

Three types spell chunking options, and the docs now keep them apart:
`ChunkingOptions` (`chunkSize`/`chunkOverlap`) for `chunkText()` and
`generateEmbedding()`; `ChunkingConfig` (`maxTokens`/`overlap`, in tokens) for a
field's `chunking:`; and `BuildTimeConfig` (`chunkSize`/`chunkOverlap` again, in
characters).

`ChunkingOptions`' unit depends on the strategy, so stating it flatly would be
wrong. Under `recursive`, `sentence` and `sliding-window` its numbers are
characters. Under `token-aware` they are tokens: `chunkText` hands `chunkOverlap`
to `tokenAwareChunk`, which multiplies it by ~4 characters per token, and does
the same to `chunkSize` when no `tokenLimit` is given. The `token-aware` example
in the advanced guide already said so inline (`chunkOverlap: 50, // Overlap in
tokens`) and was correct.

An earlier round renamed three field-level `chunking:` blocks from the first
spelling to the second but carried their numbers across the unit change, so
`1000` characters became `1000` tokens. At the ~4 characters-per-token ratio the
same page states, those are now `maxTokens: 250` / `overlap: 50` and
`maxTokens: 125`, and the guide says which unit a field's `chunking:` is in.

Correcting an earlier claim of ours about that rename: it did not break correct
code. The field-config misuse dates to `afa865f6` (#741), and that sweep's only
two chunking edits were both `chunkText` call sites moved in the correct
direction. The accurate statement is that the earlier sweep went one direction
only.
