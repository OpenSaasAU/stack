---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

`needs` takes an object form that reaches any depth, so a computed field over a chain of relations no longer reads per row (ADR-0085).

```ts
label: virtual({
  type: 'string',
  needs: { enrolment: { student: true, classTerm: ['class', 'term'] } },
  hooks: {
    resolveOutput: ({ item }) => `${item.enrolment?.student?.name ?? ''}`,
  },
})
```

A column takes `true`. A relation takes `true` for its rows' stored columns, or an array or object for exactly what is named beneath it. Every hop keeps its list's `query` access. The array form still reaches one hop.

- A synthetic back-relation (`from_<List>_<field>`) is accepted as a key in either form.
- `pnpm generate` warns when an array form names a relation whose list has a computed field with relation `needs` of its own, and prints the object form.
- A hook is handed shallow copies of its declared rows, carrying no relation it did not declare and each multi-column field under its own key in place of its part columns.
- A field `read` rule sees one hop: a relation on a related row is withheld.

Re-run `pnpm generate` after adopting it.
