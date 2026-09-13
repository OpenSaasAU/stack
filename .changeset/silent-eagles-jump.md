---
'@opensaas/stack-core': minor
'@opensaas/stack-rag': patch
---

Fix a read-restricted `embedding()` field re-embedding on every write forever: the regeneration skip read the stored hash off the write's own Field-Visibility-filtered projection instead of the row, so a session denied read on the field always saw `undefined` and paid for a fresh provider call on every subsequent write (#1282). The regeneration check now costs one extra id-scoped read per write on a list with an `autoGenerate` embedding field, whether or not the field is read-restricted — a fixed, small price for correctness the in-memory comparison could no longer pay for.

`@opensaas/stack-core` gains `readPluginOwnedRow` and `HandlelessPluginFieldReadError` from `@opensaas/stack-core/extend` — the read-side twin of `writePluginOwnedField` (ADR-0068), for a plugin that needs to see a row as persisted rather than through the caller's access-controlled projection:

```typescript
import { readPluginOwnedRow } from '@opensaas/stack-core/extend'

const row = await readPluginOwnedRow({ context, listName: 'Article', id })
```
