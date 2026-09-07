---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-storage': minor
'@opensaas/stack-tiptap': minor
'@opensaas/stack-rag': minor
'@opensaas/stack-auth': minor
'@opensaas/stack-ui': minor
---

Remove the PSL-shaped and TypeScript-face members from the field-builder contract

**Third-party field packages must migrate.** The generator emits a TypeScript
contract module, not PSL (ADR-0040), and reads a field's TypeScript face from
`outputType`/`inputType` (ADR-0052). Nothing consulted the PSL-shaped members
any more, so they are gone from `BaseFieldConfig` and from every builder:

- `getPrismaType`
- `getPrismaColumns`
- `getPrismaRelation`
- `getTypeScriptType`
- `getTypeScriptImports`
- `resultExtension`
- `VirtualField.outputType` (the required `string` narrowing; the optional
  `outputType: TypeDescriptor` on `BaseFieldConfig` is what a virtual field
  declares now)

The `PrismaRelationResult`, `MultiColumnPrismaResult` and `ResultExtensionConfig`
types they were shaped by are removed with them.

Migrating a field builder — describe the column instead of the PSL line:

```ts
// Before
export function slug(options?: Omit<SlugField, 'type'>): SlugField {
  return {
    type: 'slug',
    ...options,
    getZodSchema: () => z.string().optional(),
    getPrismaType: () => ({ type: 'String', modifiers: '? @unique' }),
    getTypeScriptType: () => ({ type: 'string', optional: true }),
  }
}

// After
export function slug(options?: Omit<SlugField, 'type'>): SlugField {
  return {
    type: 'slug',
    ...options,
    getZodSchema: () => z.string().optional(),
    getContractField: (fieldName) => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'text' },
      nullable: true,
      unique: true,
    }),
  }
}
```

A field whose TypeScript face differs from its column's codec type declares it
directly, rather than through `resultExtension` or `getTypeScriptType`:

```ts
// Before
resultExtension: { outputType: "import('@my/pkg').Metadata | null" },
getTypeScriptType: () => ({ type: 'Metadata | null', optional: true }),
getTypeScriptImports: () => [{ names: ['Metadata'], from: '@my/pkg' }],

// After — the import is inline, so no separate import declaration is needed
outputType: "import('@my/pkg').Metadata | null",
inputType: "File | import('@my/pkg').Metadata | null",
```

A field spanning several physical columns returns `{ kind: 'columns', columns }`
from `getContractField` and keeps `getColumnNames`/`assembleColumns`/`splitColumns`.

**The generate-time gate moved with the contract.** `validateFieldConfig` now
requires `getContractField` and `getZodSchema` from a stored field (a
relationship only the former), and additionally `outputType` from a field that
has no single column to be typed from — a virtual field, or one spanning
several columns. That closes a hole where such a field passed the gate,
generated successfully, and left every consumer reading it as `unknown`
(issue #1292). `FieldConfigValidationError.missingMethod` is renamed to
`missingMember` to carry `outputType` alongside the two methods.

`db.keystoneCompat`'s implicit empty-string text default is now carried by
`text()`'s contract column, where the deleted `getPrismaType` used to emit it.
