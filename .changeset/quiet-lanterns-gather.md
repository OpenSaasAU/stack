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
has no single column to be typed from — a virtual field, or one whose
descriptor is `kind: 'columns'`. That closes a hole where such a field passed
the gate, generated successfully, and left every consumer reading it as
`unknown` (issue #1292). `FieldConfigValidationError.missingMethod` is renamed
to `missingMember` to carry `outputType` alongside the two methods, and
`validateFieldConfig` takes the config as an optional fourth argument — that is
what makes the descriptor readable, so a caller passing none (rather than
`validateConfigFields`, which the generate path runs) does not get the
`columns` check.

**A field-level hook's value type now comes from the generated item.**
`FieldHooks`' `resolveInput`/`resolveOutput` positions used to be typed from
the deleted `getTypeScriptType`. They are now the field's `outputType` when it
declares one, and otherwise the property the generated `Lists.<List>.Item`
carries for it — so a stored field is typed by its contract column rather than
left open. A hand-authored `TypeInfo`, whose `item` carries no per-field facts,
still falls back to `unknown`.

`db.keystoneCompat`'s implicit empty-string text default is now carried by
`text()`'s contract column, where the deleted `getPrismaType` used to emit it —
but only where the field's own create validator accepts `''`. A column default
drops the column from the required half of the generated `CreateInput`, so
carrying one on a `validation: { isRequired: true }` text column (or one with a
non-empty `length.min`) would type-check a `create` that then threw
`ValidationError`. Those columns keep no default; a column made non-null
through `db: { isNullable: false }` alone still gets one.

**Test coverage that thinned.** Three assertions were lost rather than ported,
and are recorded here so the change is not silent:

- `select()`'s "falls back to a capitalized `fieldName` when `listName` is not
  provided" — `getContractField` is always given a `listKey`.
- The quoted-vs-unquoted PSL default rendering for a string versus an enum
  `select()` — the contract carries one `{ kind: 'literal' }` for both.
- The per-field `getTypeScriptType` blocks in `tests/field-types.test.ts`
  became `expect(field.outputType).toBeUndefined()` — "declares no override",
  which is weaker than the old "text is `string`, optional when not required".
  Column nullability is still asserted on the same fields, and the codec now
  owns the type (ADR-0052), so the fact has moved rather than vanished.
