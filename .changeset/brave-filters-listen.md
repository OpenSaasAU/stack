---
'@opensaas/stack-core': minor
'@opensaas/stack-rag': patch
---

Export the access-filter builder from the public entry

`checkAccess` and `mergeFilters` — the two primitives every access-scoped read is
built from — are now supported API on `@opensaas/stack-core`, with TSDoc. A
package that reads outside `context.db` (a vector search issuing its own SQL, a
plugin composing a filter) imports them instead of carrying a copy that drifts
from the engine's own evaluation (ADR-0038, ADR-0057):

```typescript
import { checkAccess, mergeFilters } from '@opensaas/stack-core'

const result = await checkAccess(config.lists.Post.access?.operation?.query, {
  session: context.session,
  context,
})

// `null` is the Silent failure signal: denied, so do not query at all.
const where = mergeFilters(callerWhere, result)
if (where === null) return []
```

An absent rule denies. A filter result is ANDed with the caller's `where`, never
merged key-by-key, so it can only ever narrow what the caller asked for.

`@opensaas/stack-rag` drops its own copies of both — the ones ADR-0038 names as
the reason this export exists — and calls core's. Behaviour is unchanged;
`buildAccessControlFilter`, `mergeAccessFilter` and `prismaFilterToSQL` keep
their signatures.
