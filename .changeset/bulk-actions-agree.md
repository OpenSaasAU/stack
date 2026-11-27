---
'@opensaas/stack-ui': minor
'@opensaas/stack-core': minor
'create-opensaas-app': patch
---

Bulk actions run in one transaction, and the selection bar behaves like Row actions

A Bulk action's handler now runs inside one transaction, with its `context` bound
to it, so a handler that throws part way rolls back every write it made. Keep slow
external calls out of the handler, since they hold the transaction open.

In the list view, a Bulk action that cannot reach the server says the result is
unknown and refreshes. The selection bar is disabled while one runs, and the table
stays on the current page afterwards. The status line can be dismissed. A refused
row delete says it may already be gone, or the session may not have access.

Confirmations now pluralise by English rules ("Delete 2 categories"). A list with
an irregular plural sets `ui.plural`:

```typescript
const Person = list({ fields: { name: text() }, ui: { plural: 'People' } })
```
