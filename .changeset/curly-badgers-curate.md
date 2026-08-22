---
'@opensaas/stack-core': minor
---

Add `ui.listView.defaultColumn` to field config — a declared, presentation-only flag (default `true`) controlling whether a field belongs in a list/related-list table's default column set. Naming a field explicitly in `ui.listView.initialColumns` or a relationship's `ui.itemView.columns` always shows it regardless of this flag.

```typescript
fields: {
  internalScore: integer({ ui: { listView: { defaultColumn: false } } }),
}
```

`password()` now sets this flag to `false` by default instead of the admin UI matching on field type — a password field can opt back into default columns with `ui: { listView: { defaultColumn: true } } }`.
