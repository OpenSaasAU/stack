---
'@opensaas/stack-core': minor
---

A field that declares `getContractField` satisfies the self-containment gate on its own

`validateConfigFields` — the check `pnpm generate` runs over every stored field before it
reads any contract — required the PSL-shaped `getPrismaType` and `getTypeScriptType` from
every non-virtual field. Those two describe one Prisma column and one TypeScript type, and
neither is read by anything on the contract-era generators: columns come from
`getContractField`, and the emitted types come from `outputType`/`inputType`, else from
the column's own codec.

For a field spanning several columns of different types there is no honest single
`getPrismaType` to give, so the gate was forcing field packages to declare a plausible but
false one purely to pass it — `@opensaas/stack-rag`'s `embedding()` is a `vector(n)` column
plus a `jsonb` column, and had to claim `Json?`.

A field that declares `getContractField` now satisfies the gate without either PSL method.
`getZodSchema` is still required of it — no contract supplies validation. Relationship and
virtual fields are unchanged, and a stored field that declares no contract still has to
provide the pair.

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

This affects field packages, not applications: a field builder that keeps `getPrismaType`
and `getTypeScriptType` is unchanged, and no config has to be edited.
