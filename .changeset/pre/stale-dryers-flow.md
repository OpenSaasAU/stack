---
'@opensaas/stack-storage': minor
'@opensaas/stack-core': patch
---

Fix a critical security issue (#1619): `image()`/`file()` fields trusted a caller-supplied metadata-shaped value (`{ filename, url, ... }`) verbatim, so cleanup would later delete whatever path it named through whatever provider it named — arbitrary file deletion via a traversal `filename`, and cross-row deletion by copying another row's metadata.

A metadata-shaped write is now accepted only when it deep-equals the field's own currently stored value (the admin form's resubmit-unchanged case), or when the write runs under `sudo()` (seed/migration scripts pointing a new row at an already-uploaded asset):

```typescript
// Non-sudo create with metadata-shaped input is refused — upload a File instead.
await context.db.Doc.create({ data: { attachment: someMetadata } }) // throws

// Sudo may still point a new row at an existing asset.
await context.sudo().db.Doc.create({ data: { attachment: someMetadata } })

// Non-sudo update succeeds only when the value matches what's already stored.
await context.db.Doc.update({ where: { id }, data: { attachment: row.attachment } }) // OK
await context.db.Doc.update({ where: { id }, data: { attachment: otherRowsMetadata } }) // throws
```

Cleanup (`cleanupOnDelete`/`cleanupOnReplace`) now always deletes through the field's own configured `storage` provider, never the `storageProvider` a stored value happens to name, and `LocalStorageProvider` resolves every `filename` it's given (`upload`, `download`, `delete`, `getUrl`) against `uploadDir`, refusing anything that isn't a plain filename strictly inside it. With `generateUniqueFilenames: false`, a traversal-shaped upload name is reduced to a safe basename instead of being written verbatim.

`ImageTransformationResult` (`@opensaas/stack-core`) gains an optional `filename` field, populated from the provider's own upload result, so `deleteImage` deletes a transformation variant by the key the upload recorded rather than by parsing it out of the stored `url`.
