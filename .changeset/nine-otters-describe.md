---
'@opensaas/stack-storage': minor
'@opensaas/stack-tiptap': minor
---

`file()`, `image()` and `richText()` describe their columns and their TypeScript face through the contract-shaped field-builder surface

Each builder now carries `getContractField`, which is what `opensaas generate` reads to derive the Contract, and declares its TypeScript face through `outputType`/`inputType` rather than `getTypeScriptType`/`getTypeScriptImports`/`resultExtension`. The old methods are still declared — nothing calls them at generation time any more.

`image()`/`file()` in Keystone-parity multi-column mode return the `kind: 'columns'` variant, so one logical field still emits its per-part physical columns:

```ts
image({ storage: 'images', db: { columns: 'keystone' } })
// image_url text, image_width int, image_height int, image_filesize int,
// image_contentType text, image_contentDisposition text, image_pathname text
```

The `db.map`, `db.isNullable` and `db.nativeType` overrides the single-column backing documents now reach the emitted column; previously they were declared but dropped. Two of them are a **schema change for a config that already sets them**:

- **`db.isNullable: false` now emits a NOT NULL column**, and the field's TypeScript face and validation follow it: `outputType`/`inputType` lose their `| null`, `null` is rejected, and the key becomes required on create (still omittable on update). A config that set `isNullable: false` while relying on the previously-nullable column must drop the override, or backfill the column before migrating.
- **`db.nativeType: 'Json'` now emits a `json` column, not `jsonb`.** The override was a no-op before, so the column was always `jsonb`; it is now honoured literally. `json` and `jsonb` differ in equality and indexing semantics, and the change generates a type-altering migration on an existing table. Set `nativeType: 'Jsonb'` (or drop the override) to keep the previous column type.

A `db.nativeType` value outside the Postgres types the contract carries is now a `opensaas generate` error naming the list and field, where it was previously ignored.

**`db.isNullable` alongside `db.columns` is now refused at generate time.** Multi-column mode has no single column for it to constrain — every part column is nullable, and an all-NULL row reads back as `null` — so `db: { isNullable: false, columns: 'keystone' }` could only ever be taken and dropped. It is now an `opensaas generate` error naming the list, the field and the fix, rather than a silently ignored option. Remove `db.isNullable`, or remove `db.columns` to use the single-`Json?` column the override applies to. `isNullable: true` alongside `db.columns` still passes, and single-column mode is unaffected.

**Bug fix: a multi-column `file()` with a `parts` subset wrote to columns its schema does not carry.** `splitFileMetadata` seeded `filename`, `filesize` and `url` before consulting `parts`, so a field configured as `db: { columns: { mode: 'keystone', parts: ['url', 'contentType'] } }` emitted a write payload naming `<field>_filename` and `<field>_filesize` — columns the generated schema never declared, which Prisma rejects as unknown fields. This affects released `@opensaas/stack-storage`; only a `file()` in multi-column mode with a non-default `parts` is reachable, and `image()` and default-`parts` fields were never affected. Writes now name exactly the opted-in part columns, so such a field works without changing your config.

`@opensaas/stack-tiptap` re-exports Tiptap's `JSONContent`, and `richText()` reads and writes as that type instead of `any`:

```ts
const article = await context.db.article.findFirst()
article.body // import('@opensaas/stack-tiptap').JSONContent | null
```
