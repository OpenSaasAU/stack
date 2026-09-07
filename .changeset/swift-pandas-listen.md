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
`unknown` and `config.dimensions` is not on the union at all. Reading them
straight onto the returned `EmbeddingProvider` was two type errors; the example
now narrows both, and says why:

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
      /* … */
    },
  }
})
```

The README's Examples section pointed at `examples/rag-demo`, which does not
exist, and credited it with MCP integration and multiple providers, which
neither real example has. It now names `examples/rag-ollama-demo` and
`examples/rag-openai-chatbot` and says what each actually demonstrates.
