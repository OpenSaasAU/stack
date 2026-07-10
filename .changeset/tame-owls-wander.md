---
'@opensaas/stack-ui': minor
---

Wire the edit page onto the relationship-options primitive so relationship dropdowns are fast and live-searchable. The item-form preparation now fetches a bounded, take-limited window via `getRelationshipOptions` instead of an unbounded `findMany({})` per relationship field, always unioning the current value's id(s) so its label renders even outside the window.

`ComboboxField` (single) and `RelationshipManager` (many) gain debounced live search: typing narrows results against the label field via the `relationshipOptions` serverAction op, without any wiring changes required in host apps — `ItemForm`/`SingletonView` already pass `serverAction` and `listKey` through.

```typescript
// No config changes needed — AdminUI's edit page picks this up automatically.
// A field's relationship dropdown now:
// 1. Renders a bounded initial window (default 50) with the current value's label always visible
// 2. Debounces typed input and searches server-side via context.serverAction({ action: 'relationshipOptions', ... })
```

Components without a wired `serverAction` (e.g. custom usages of `ComboboxField`/`RelationshipManager`) fall back to client-side filtering over the initial window, unchanged from previous behavior.
