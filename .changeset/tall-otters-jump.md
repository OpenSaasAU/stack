---
'@opensaas/stack-storage': minor
---

Add `pathname` and `contentType` as optional extra columns for `file()`'s `db.columns: 'keystone'` multi-column mode, matching the parts `image()`'s multi-column mode already supports.

By default, multi-column `file()` fields still emit exactly the same three columns as before (`filename`/`filesize`/`url`) — no changes for existing configs. To opt into the extras (e.g. for a legacy Keystone `file` field that content-sniffs a MIME type or stores a storage-provider pathname), pass `parts`:

```typescript
import { file } from '@opensaas/stack-storage/fields'
import { FILE_COLUMN_PARTS } from '@opensaas/stack-storage'

resume: file({
  storage: 'documents',
  db: {
    columns: {
      mode: 'keystone',
      parts: FILE_COLUMN_PARTS, // all five: filename, filesize, url, pathname, contentType
    },
  },
})
```

The two extras round-trip through `FileMetadata.metadata.pathname` / `FileMetadata.metadata.contentType`, the same way `image()`'s `contentDisposition` round-trips through `ImageMetadata.metadata`.
