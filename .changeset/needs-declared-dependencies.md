---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add `needs` to the base field config: a computed field can declare the immediate relations its `resolveOutput` hook depends on, so the read fetches exactly those — without widening what the caller receives (ADR-0025).

Since ADR-0024, a bare read (no caller `include`) returns a row's own columns only, so a virtual field reading `item.someRelation` silently computed over `undefined` unless a caller happened to include it. `needs` fixes that:

```typescript
Order: list({
  fields: {
    lineItems: relationship({ ref: 'LineItem.order', many: true }),
    total: virtual({
      type: 'number',
      needs: ['lineItems'],
      hooks: {
        resolveOutput: ({ item }) =>
          item.lineItems.reduce((sum, li) => sum + li.price * li.quantity, 0),
      },
    }),
  },
})
```

The declared relation is fetched wherever the field is computed — at the root of a read and at every nested level — and is scoped through the Access Filter exactly like a caller-named relation: a dependency the session can't query is not fetched, and the hook sees nothing in its place. A field always computes on whatever it can see, so a partially-denied dependency still produces a value rather than being withheld. The relation itself is stripped from the result unless the caller named it too, for both `include` reads and fragment `query` reads.

`needs` is available on every field type, not only `virtual()`. `opensaas generate` now also validates every `needs` declaration: an entry naming a non-relationship or non-existent field, or a declaration closure that can't fit within the read-include depth cap from any starting point, fails generation with a message naming the offending field/chain rather than silently truncating at runtime.

See `docs/adr/0025-a-computed-field-declares-the-relations-it-needs.md`.
