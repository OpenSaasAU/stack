---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add list-level `ui.listView` config (mirroring Keystone) for default columns and sort

Lists now support a `ui.listView` block in `opensaas.config.ts` that sets the
admin list table's default column selection/order and default sort. Naming
mirrors Keystone's `ui.listView` so migrators can map defaults directly.

```typescript
lists: {
  Post: list({
    fields: {
      title: text(),
      status: text(),
      createdAt: timestamp(),
    },
    ui: {
      listView: {
        // Column selection AND order
        initialColumns: ['title', 'status'],
        // Default sort
        initialSort: { field: 'createdAt', direction: 'desc' },
      },
    },
  }),
}
```

When `ui.listView` is absent, behaviour is unchanged: the table shows all
non-system fields and applies no default sort.
