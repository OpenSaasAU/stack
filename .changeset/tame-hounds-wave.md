---
'@opensaas/stack-core': minor
---

Fix `FieldAccess['read']` typing `item` as absent when Field Visibility always passes the fetched row. A field `read` rule that reads a property off `item` now compiles without a cast, `any`, or non-null assertion:

```ts
// Before (required a cast/assertion — `item` was typed `undefined`)
internalNotes: text({
  access: { read: ({ item, session }) => item!.ownerId === session?.userId } as FieldAccessControl,
})

// After (compiles as written — `item` is typed as the row)
internalNotes: text({
  access: { read: ({ item, session }) => item.ownerId === session?.userId },
})
```

`FieldAccess['read']` now accepts only the single `operation: 'read'` call shape (rather than the full `read | create | update` union `FieldAccess['create']`/`FieldAccess['update']` still accept), so a rule written for the `read` slot never needs to narrow on `operation` to use `item`. The `create` branch — where there genuinely is no row yet — is unchanged.
