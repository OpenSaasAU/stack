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
what makes the descriptor readable. A caller passing none falls back to the
optional `getColumnNames` as a stand-in for the descriptor's `kind`, so the
public three-argument form still applies the requirement. The gate also
swallows a throw out of `getContractField`: that is a field's own refusal seam
(`embedding()` throws there for an impossible `dimensions`), and it is designed
to surface from `deriveContract`, inside the guard that prints it and exits.

`inputType` is never required by the generator. On a single-column field its
absence means the column's own input type; a `kind: 'columns'` field has no
single column for that to name, so it should declare `inputType` alongside
`outputType` — every multi-column field in this repo does, and what the
generator emits for one that does not is untested.

**A field-level hook's value type is resolved from the field key, and is
`unknown` when there is no single key to resolve.** `FieldHooks`'
`resolveInput`/`resolveOutput` positions used to be typed from the deleted
`getTypeScriptType`. `FieldHooks<TTypeInfo, 'title'>` now resolves to the
field's statically declared `outputType`, or else to the property the generated
`Lists.<List>.Item` carries for it.

But `BaseFieldConfig.hooks` cannot pin a field key — a builder is written
before it knows where it is mounted — so through the config surface
(`list<Lists.Post.TypeInfo>({ fields: { title: text({ hooks }) } })`) the
instantiation is `FieldHooks<TTypeInfo>`, whose key is the union of every field
on the list, and the value type is **`unknown`**: the same open type as before
this change. Resolving that union would type each field's hook by the whole
row, so a `text()` hook would accept a `Date` and reject its own `string`. An
honestly `unknown` type is better than a confidently wrong one; narrowing it
needs the field key threaded into `BaseFieldConfig`, which is its own change.

Two related limits, for the same reason: `lists.ts` emits `Fields` as the field
_interfaces_, on which `outputType` is optional, so a declared face never
survives into a generated `TypeInfo` — the declared branch is reachable only
from a hand-authored one. And a virtual field's hook value stays `unknown`,
since it has no declared face there and no column in the stored row.

`db.keystoneCompat`'s implicit empty-string text default is now carried by
`text()`'s contract column, where the deleted `getPrismaType` used to emit it —
but only where the field's own create validator accepts the omission that
default is there to fill. A column default drops the column from the required
half of the generated `CreateInput`, so carrying one on a
`validation: { isRequired: true }` text column would type-check a `create` that
then threw `ValidationError`.

**Known limit: the flag is therefore inert for `validation: { isRequired: true }`
text, Keystone's commonest text column.** Keystone 6 renders that column as
`NOT NULL DEFAULT ''`, so a migrating project sees `DROP DEFAULT` for it in
`migrate diff` and must set `defaultValue: ''` on those fields by hand. Full
parity would need the flag to relax the create validator as well, which
`getZodSchema` has no config to read; that is a separate change. A column made
non-null through `db: { isNullable: false }` alone — with or without a
`length.min`, which constrains a supplied value rather than an omitted one —
still gets the default.

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
