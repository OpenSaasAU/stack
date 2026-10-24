---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

List-level admin UI options `ui.hideCreate`, `ui.hideDelete` and `ui.itemView.defaultFieldMode`

Each takes a literal or a function of the session, resolved on the server. They change what the admin offers, never access control, hooks or server actions.

```typescript
Ledger: list({
  access: { operation: { create: isAdmin, update: isAdmin, delete: isAdmin } },
  ui: {
    hideCreate: true,
    hideDelete: ({ session }) => session?.role !== 'OWNER',
    itemView: { defaultFieldMode: 'read' },
  },
})
```

`hideCreate` removes the list header, empty-state, dashboard and relationship-drawer Create affordances and renders `/create` as not-found. `hideDelete` removes row, bulk and item-view Delete. `defaultFieldMode: 'read'` renders the item view read-only with no Save.
