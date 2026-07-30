---
'@opensaas/stack-core': minor
---

**Behavior change:** reads that previously returned deeply-nested relation data unscoped now throw instead. A caller-supplied `include` nested past the Access Filter's read-include depth cap (`READ_INCLUDE_MAX_DEPTH`, 5) used to fail OPEN — the relation was fetched with no row filter and its fields were never access-checked or `resolveOutput`-processed. It now fails CLOSED: the read throws a new `AccessScopeDepthExceededError` (exported from `@opensaas/stack-core`) naming the list, relation field, and depth reached, instead of returning unscoped data.

```typescript
import { AccessScopeDepthExceededError } from '@opensaas/stack-core'

try {
  await context.db.post.findMany({
    include: { author: { include: {/* … nested past the depth cap */} } },
  })
} catch (err) {
  if (err instanceof AccessScopeDepthExceededError) {
    // err.listKey / err.fieldKey / err.depth — restructure into shallower reads.
  }
}
```

An ordinary read with no caller `include`, or one within the depth limit, is unaffected — the auto-include still stops silently at the cap, matching prior behavior. A read issued from inside a `resolveOutput`/virtual-field hook now also row-scopes its immediate relations (previously it skipped scoping entirely at that point). Field-level read access and `resolveOutput` hooks are now applied at every nesting depth on the returned rows, with no independent cap of their own. See ADR-0022 and issue #830.
