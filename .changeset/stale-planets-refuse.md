---
'@opensaas/stack-core': minor
---

Close an access-control gap in nested relationship writes (#1384). Non-sudo `context.db` writes carrying a nested `set`, `updateMany` or `deleteMany` under a relationship key previously reached Prisma as an unchecked pass-through — the target list's `operation.update`/`operation.delete` access was never consulted, no hooks ran, and an unscoped `where` could reach rows well outside the parent's own subtree. These three kinds are now refused outright for non-sudo contexts, throwing a new `NestedRelationInputError` (exported from `@opensaas/stack-core`) that names the list, the relationship field, and the offending kind(s):

```typescript
import { NestedRelationInputError } from '@opensaas/stack-core'

try {
  await context.db.post.update({
    where: { id },
    data: { tags: { deleteMany: {} } },
  })
} catch (err) {
  if (err instanceof NestedRelationInputError) {
    // err.listKey / err.fieldKey / err.kinds
  }
}
```

Replace a nested `set`/`updateMany`/`deleteMany` with writes against the target list directly (`context.db.<targetList>`), wrapped in `context.transaction()` when they must land atomically with the parent write. `context.sudo()` still accepts all three kinds unchanged, matching every other access-control escape hatch in the write pipeline.

Nested `disconnect`'s target-row form (`{ disconnect: { id } }`, as opposed to the to-one `{ disconnect: true }`) is now gated by the target list's `operation.query` access, the same reachability check `connect` already applies — a caller can no longer disconnect a row it cannot read. This closes the last unchecked nested-write shape from the same report.
