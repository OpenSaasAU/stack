---
'@opensaas/stack-core': minor
---

A computed field — any field carrying a `resolveOutput` hook, virtual or not — is now computed if and only if a read is actually going to return it. A fragment `query` that selects three fields no longer runs every `resolveOutput` on the list and discards the rest: an unselected field's field-level read access is never evaluated and its hook never runs. Its declared relations (`needs`, ADR-0025) are fetched under exactly the same condition, folded recursively at every nesting level — a nested fragment selecting a subset computes only that subset, while a nested `include` still computes every computed field at that level, matching bare and `include`-based reads, which are unaffected: they still compute every computed field on the list, exactly as before. See ADR-0027.

**This is a silent break — detect it before you upgrade, the same way ADR-0024's and ADR-0026's were.** Two independent behaviors changed with no thrown error:

1. **A hook's `item` never carries another computed field's resolved output, on any read path.** Previously a virtual field received the already-assembled, already-resolved object, so a virtual field could read an _earlier-declared_ virtual (or any field carrying its own `resolveOutput`, e.g. a `password()`'s wrapper or a formatted display field) and see its resolved value — working only by declaration order, with reordering two fields silently changing the result. Now every computed field's hook sees only the row's stored columns and its own declared dependencies; reaching for a sibling that is itself computed finds nothing there (or its raw stored form, never the wrapped/resolved value), the same as reaching for a field that was never declared. **Grep your config for a `resolveOutput` whose `item` reads a field that is itself computed** — virtual fields reading other virtual fields, or a hook reading a stored field that carries its own `resolveOutput` (a password wrapper, a formatted date) — and recompute from the shared stored columns instead of relying on another field's hook having already run.
2. **A field's hook no longer runs just because it's on the list — only because a read selects it.** If you relied on a `resolveOutput` hook running for a side effect (logging, cache warming) on every read regardless of a fragment's own field selection, that side effect now only fires when the fragment actually names the field. **Grep for a fragment `query` that intentionally omits a field whose hook you were relying on for a side effect**, and select that field explicitly (or move the side effect to a hook that isn't projection-gated, e.g. `afterOperation`).

A hookless virtual field (one with `access.read` but no `resolveOutput`) no longer has its read access evaluated at all on any read — such a field can never produce output, so under this rule it does no work at all.

```typescript
// Before: `displayName` (declared after `fullNameCached`) could read the
// latter's resolved value purely because of declaration order.
User: list({
  fields: {
    firstName: text(),
    lastName: text(),
    fullNameCached: virtual({
      type: 'string',
      hooks: { resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}` },
    }),
    displayName: virtual({
      type: 'string',
      // item.fullNameCached is now always undefined here — recompute from
      // the shared stored columns instead.
      hooks: { resolveOutput: ({ item }) => `${item.fullNameCached} (${item.firstName[0]}.)` },
    }),
  },
})

// After: compute from the stored columns both fields actually share.
displayName: virtual({
  type: 'string',
  hooks: {
    resolveOutput: ({ item }) => `${item.firstName} ${item.lastName} (${item.firstName[0]}.)`,
  },
}),
```
