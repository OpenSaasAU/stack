---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Require `assembleColumns` on every multi-column field

A field whose `getContractField` returns `{ kind: 'columns' }` must now supply `assembleColumns`. Without it the field had no value under its own key, so `.select()` returned nothing for it, a `needs` entry naming it gave the hook nothing, and MCP advertised a field it never returned. `opensaas generate` now refuses such a config, and so does building a context over it, naming the list, the field and the member:

```
Profile.avatar (type "avatar") is missing assembleColumns()
```

Migration: supply `assembleColumns` on any `kind: 'columns'` field.

```typescript
import type { BaseFieldConfig, TypeInfo } from '@opensaas/stack-core/extend'
import { z } from 'zod'

const avatar: BaseFieldConfig<TypeInfo> = {
  type: 'avatar',
  outputType: '{ filename: string | null; filesize: number | null }',
  getZodSchema: () => z.object({ filename: z.string(), filesize: z.number() }).nullable(),
  getContractField: () => ({
    kind: 'columns',
    columns: [
      { name: 'avatar_filename', type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: 'avatar_filesize', type: { pack: 'pg', type: 'int' }, nullable: true },
    ],
  }),
  assembleColumns: (_fieldName, row) =>
    row.avatar_filename === null
      ? null
      : { filename: row.avatar_filename, filesize: row.avatar_filesize },
  splitColumns: (_fieldName, value) => {
    const parts = typeof value === 'object' && value !== null ? value : {}
    return {
      avatar_filename: 'filename' in parts ? parts.filename : null,
      avatar_filesize: 'filesize' in parts ? parts.filesize : null,
    }
  },
}
```

`image()`/`file()` in multi-column mode and `embedding()` already supply it.
