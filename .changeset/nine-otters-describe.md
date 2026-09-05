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

The `db.map`, `db.isNullable` and `db.nativeType` overrides the single-column backing documents now reach the emitted column; previously they were declared but dropped.

`@opensaas/stack-tiptap` re-exports Tiptap's `JSONContent`, and `richText()` reads and writes as that type instead of `any`:

```ts
const article = await context.db.article.findFirst()
article.body // import('@opensaas/stack-tiptap').JSONContent | null
```
