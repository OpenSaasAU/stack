---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': patch
'create-opensaas-app': patch
---

Resolve Session vocabulary answers lazily, one question at a time

A list's Session vocabulary no longer resolves every rule of the list on the first ask. Each answer (an operation, a field's `read`/`create`/`update`, `filterable`, `sortable`) is asked only when a consumer needs it, and is memoised on its own for the context's life, so asking a related list's `query` and one field's `filterable` asks only those two rules. The whole vocabulary is assembled from the same answers, so no rule is asked twice per context.

`@opensaas/stack-core/testing` gains `untypedRule`, for declaring a rule that answers `null` or `undefined` (which the engine reads as deny) in a typed test:

```ts
import { untypedRule } from '@opensaas/stack-core/testing'

const lists = {
  Post: { fields: {}, access: { operation: { query: untypedRule(() => null) } } },
}
```

`resolveNavCounts` no longer rejects when reading a list's vocabulary fails: that list's badge is omitted and logged, while a framework's control flow still propagates. The admin's list view filter labels, Relationship table column labels and link controls, item form relationship options and operation gates ask a related list only the questions they need.
