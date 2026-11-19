---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': patch
'create-opensaas-app': patch
---

Resolve Session vocabulary answers lazily, one question at a time

A list's Session vocabulary no longer resolves every rule of the list on the first ask. Each answer (an operation, a field's `read`/`create`/`update`, `filterable`, `sortable`) is asked only when a consumer needs it, and is memoised on its own for the context's life, so asking a related list's `query` and one field's `filterable` asks only those two rules. The whole vocabulary is assembled from the same answers, so no rule is asked twice per context.

The admin's list view filter labels, Relationship table column labels and link controls, item form relationship options and operation gates ask a related list only the questions they need.

`resolveNavCounts` behaviour changes:

- A list whose vocabulary read fails is now omitted and logged instead of rejecting the whole call.
- A framework's control flow (`redirect()`, `notFound()`) raised by a list's count call (`aggregate`) was previously caught, logged and the badge dropped; it now propagates out of `resolveNavCounts`, as control flow from the vocabulary read already did.
