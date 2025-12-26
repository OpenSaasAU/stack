---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add singleton lists support for single-record tables

You can now create singleton lists (lists that should only ever have one record) by setting `isSingleton: true`. This is useful for Settings, Configuration, or other global single-record tables.

Features:

- Prevents creating multiple records (throws error on second create)
- Auto-creates record with field defaults on first access (configurable)
- Provides a `get()` method for easy access to the singleton record
- Blocks `delete` and `findMany` operations on singleton lists
- Works with all existing access control and hooks

Usage:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, checkbox, integer } from '@opensaas/stack-core/fields'

export default config({
  lists: {
    Settings: list({
      fields: {
        siteName: text({ defaultValue: 'My Site' }),
        maintenanceMode: checkbox({ defaultValue: false }),
        maxUploadSize: integer({ defaultValue: 10 }),
      },
      access: {
        operation: {
          query: () => true,
          update: isAdmin,
        },
      },
      isSingleton: true, // Enable singleton mode
    }),
  },
})
```

Access the singleton record:

```typescript
// Auto-creates with defaults if no record exists
const settings = await context.db.settings.get()

// Update the singleton
await context.db.settings.update({
  where: { id: settings.id },
  data: { siteName: 'Updated Site' },
})
```

Disable auto-create:

```typescript
Settings: list({
  fields: {
    /* ... */
  },
  isSingleton: {
    autoCreate: false, // Must manually create the record
  },
})
```
