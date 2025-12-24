---
'@opensaas/stack-core': minor
---

Add `originalItem` parameter to `afterOperation` hooks for comparing previous and new values

Both field-level and list-level `afterOperation` hooks now receive an `originalItem` parameter containing the item's state before the operation. This enables use cases like detecting field changes, cleaning up old files, tracking state transitions, and sending conditional notifications.

Usage in list-level hooks:

```typescript
Post: list({
  hooks: {
    afterOperation: async ({ operation, item, originalItem, context }) => {
      if (operation === 'update' && originalItem) {
        // Compare previous and new values
        if (originalItem.status !== item.status) {
          await notifyStatusChange(originalItem.status, item.status)
        }
      }
    },
  },
})
```

Usage in field-level hooks:

```typescript
fields: {
  thumbnail: text({
    hooks: {
      afterOperation: async ({ operation, value, item, originalItem }) => {
        if (operation === 'update' && originalItem) {
          const oldValue = originalItem.thumbnail
          if (oldValue !== value && oldValue) {
            // Clean up old file when thumbnail changes
            await deleteFromCDN(oldValue)
          }
        }
      },
    },
  })
}
```

The `originalItem` parameter is:

- `undefined` for `create` and `query` operations (no previous state)
- The item before the update for `update` operations
- The item before deletion for `delete` operations
