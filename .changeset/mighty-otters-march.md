---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-storage': minor
---

Add non-destructive multi-column mode to `image()` / `file()` for adopting an existing Keystone database without dropping columns (ADR-0006).

Keystone stores an image across seven per-part columns (`_url`, `_width`, `_height`, `_filesize`, `_contentType`, `_contentDisposition`, `_pathname`) and a file across three (`_filename`, `_filesize`, `_url`). By default `image()`/`file()` still back a single `Json?` column (greenfield unchanged). Set `db.columns: 'keystone'` to map the field onto the existing per-part columns in place — assembled into an `ImageMetadata`/`FileMetadata` on read and split back on write — so a migrating project reaches a clean schema diff with no data migration and no re-upload of existing assets.

```typescript
import { image, file } from '@opensaas/stack-storage/fields'

fields: {
  // Maps onto image_url, image_width, … image_pathname in place.
  avatar: image({ storage: 'images', db: { columns: 'keystone' } }),

  // Per-part @map names are configurable for non-default column names.
  cover: image({
    storage: 'images',
    db: { columns: { mode: 'keystone', map: { url: 'cover_link' } } },
  }),

  resume: file({ storage: 'documents', db: { columns: 'keystone' } }),
}
```

No-re-upload guarantee (both modes): an already-shaped metadata value — or, in multi-column mode, populated columns — is authoritative and never triggers a storage upload; only a `File`-like input uploads.

Adds a multi-column field-emission contract (`getPrismaColumns`) plus `getColumnNames`/`assembleColumns`/`splitColumns` to the field-authoring surface so any field can map onto several physical columns. The generator emits one `@map`-ped Prisma line per column; reads assemble the logical value from the raw columns and strip them from the result; writes split the logical value back across the columns.
