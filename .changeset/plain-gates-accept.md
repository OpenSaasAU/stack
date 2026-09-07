---
'@opensaas/stack-core': minor
---

A field that declares `getContractField` satisfies the self-containment gate on its own

`validateConfigFields` — the check `pnpm generate` runs over every stored field before it
reads any contract — used to require the PSL-shaped `getPrismaType` and `getTypeScriptType`
from every non-virtual field. Those two describe one Prisma column and one TypeScript type,
and neither is read by anything on the contract-era generators: columns come from
`getContractField`, and the emitted types come from `outputType`/`inputType`, else from
the column's own codec. Both members are removed from the field-builder contract in this
same release.

For a field spanning several columns of different types there was no honest single
`getPrismaType` to give, so the gate was forcing field packages to declare a plausible but
false one purely to pass it — `@opensaas/stack-rag`'s `embedding()` is a `vector(n)` column
plus a `jsonb` column, and had to claim `Json?`.

`getContractField` is now what satisfies the gate for a stored field, with no PSL method in
the picture at all. `getZodSchema` is still required of it — no contract supplies
validation — and a field whose descriptor is `kind: 'columns'` must also declare
`outputType`, having no single column to be typed from. A relationship field needs only
`getContractField`; a virtual field needs `outputType` and `getZodSchema`. A stored field
that declares no contract now fails the gate outright: there is no PSL pair left to satisfy
it with.

```typescript
// A field package can now describe its columns once, to the contract:
export function myField(): MyField {
  return {
    type: 'myField',
    getZodSchema: () => /* … */,
    getContractField: (fieldName) => ({ kind: 'columns', columns: [/* … */] }),
    outputType: "import('@my/pkg').MyValue | null",
    inputType: "import('@my/pkg').MyValue | null",
  }
}
```

This affects field packages, not applications: a field package migrates by describing its
columns to `getContractField` once, and no application config has to be edited.
