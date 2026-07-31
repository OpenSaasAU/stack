---
'@opensaas/stack-core': minor
---

Fix unbounded recursion when a `resolveOutput` hook issues its own read (#844): a hook's read could return rows whose own `resolveOutput` hooks issued further reads with no bound, driving the process to the V8 heap limit on a cyclic readable-relationship graph.

Reads are now tracked with a resolve chain — the ordered `(list, field)` pairs a read has entered via `resolveOutput` hooks. A hook that would re-enter a pair already on its own chain throws the new `ResolveOutputCycleError` naming the full chain, instead of recursing forever:

```ts
import { ResolveOutputCycleError } from '@opensaas/stack-core'

try {
  await context.db.user.findMany({})
} catch (err) {
  if (err instanceof ResolveOutputCycleError) {
    // err.chain: readonly { listKey: string; fieldKey: string }[]
  }
}
```

An acyclic chain that runs deeper than `RESOLVE_CHAIN_MAX_LENGTH` (a cost limit, not a correctness guard) omits the field and logs a single `console.warn` instead of throwing — a legitimately terminating hook chain (e.g. a virtual field reading another virtual field several hops deep) is never denied.

This also fixes a related bug where a plain top-level read running concurrently with an unrelated in-flight `resolveOutput` hook could have its own nested auto-include silently collapsed, because the previous implementation tracked "am I inside a hook?" on one mutable counter shared by the whole request.

**Breaking (internal plumbing only):** `AccessContext`'s underscore-prefixed `_resolveOutputCounter: { depth: number }` is replaced by `_resolveOutputChain: readonly { listKey: string; fieldKey: string }[]`. Application code never reads this field. Hand-built `AccessContext` mocks in tests need a one-line update:

```ts
// Before
_resolveOutputCounter: {
  depth: 0
}
// After
_resolveOutputChain: []
```
