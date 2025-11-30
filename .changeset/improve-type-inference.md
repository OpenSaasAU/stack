---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': patch
'@opensaas/stack-ui': patch
'@opensaas/stack-auth': patch
'@opensaas/stack-tiptap': patch
'@opensaas/stack-storage': patch
'@opensaas/stack-storage-s3': patch
'@opensaas/stack-storage-vercel': patch
'@opensaas/stack-rag': patch
---

Improve TypeScript type inference for field configs by automatically passing TypeInfo from list level to fields

This change eliminates the need to manually specify type parameters on field builders when using features like virtual fields. Previously, users had to write `virtual<Lists.User.TypeInfo>({...})` to get proper type inference. Now TypeScript automatically infers the correct types from the list-level type parameter.

**Breaking Changes:**
- Field types now accept full `TTypeInfo extends TypeInfo` instead of just `TItem`
- `FieldsWithItemType` utility replaced with `FieldsWithTypeInfo`
- All field builders updated to use new type signature

**Benefits:**
- Cleaner code: write `virtual({ type: 'string', ... })` instead of `virtual<Lists.User.TypeInfo>({ type: 'string', ... })`
- Better type inference in hooks and field options
- Consistent type flow from list configuration down to individual fields

**Example:**
```typescript
// Before
User: list<Lists.User.TypeInfo>({
  fields: {
    displayName: virtual<Lists.User.TypeInfo>({
      type: 'string',
      hooks: {
        resolveOutput: ({ item }) => `${item.name} (${item.email})`
      }
    })
  }
})

// After
User: list<Lists.User.TypeInfo>({
  fields: {
    displayName: virtual({
      type: 'string',
      hooks: {
        resolveOutput: ({ item }) => `${item.name} (${item.email})`
      }
    })
  }
})
```
