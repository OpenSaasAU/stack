---
'@opensaas/stack-rag': minor
---

`ChunkingConfig`'s `strategy` field used a type also named `ChunkingStrategy`
exported from `@opensaas/stack-rag/runtime` — a different union (it lacks
`'none'`, has `'token-aware'`), so the two disagreed under the same name.
`ChunkingConfig`'s union is now exported as `ChunkingConfigStrategy`;
`chunkText`'s `ChunkingStrategy` from `@opensaas/stack-rag/runtime` is
unchanged.

```typescript
// Before
import type { ChunkingStrategy } from '@opensaas/stack-rag'

// After
import type { ChunkingConfigStrategy } from '@opensaas/stack-rag'
```
