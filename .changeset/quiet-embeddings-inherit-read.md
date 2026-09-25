---
'@opensaas/stack-rag': minor
---

Fix a security leak where a session denied read access to a `searchable()`/`embedding({ sourceField })` field's source text could still read the companion embedding's vector, its `sourceHash`, and rank rows against it with `nearest()` — including through the RAG plugin's MCP semantic-search tool.

An embedding field that names a `sourceField` now inherits that field's `read` access automatically, combined with any `read` rule you give the embedding yourself:

```typescript
fields: {
  content: searchable(text({ access: { read: isAdmin } }), { dimensions: 1536 }),
  // contentEmbedding is injected with the same effective read access as
  // content — a non-admin session can no longer read it, search it with
  // nearest(), or use it through the semantic search MCP tool.
}
```

The combination can only narrow: an embedding's own `read` rule is ANDed with the source's, so it can never widen access past what the source field allows. A source field with no `read` rule leaves the embedding readable exactly as before. See ADR-0045 (amended).
