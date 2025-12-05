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

Improve TypeScript type inference for field configs and list-level hooks by automatically passing TypeInfo from list level down

This change eliminates the need to manually specify type parameters on field builders when using features like virtual fields, and fixes a critical bug where list-level hooks weren't receiving properly typed parameters.

## Field Type Inference Improvements

Previously, users had to write `virtual<Lists.User.TypeInfo>({...})` to get proper type inference. Now TypeScript automatically infers the correct types from the list-level type parameter.

**Example:**

```typescript
// Before
User: list<Lists.User.TypeInfo>({
  fields: {
    displayName: virtual<Lists.User.TypeInfo>({
      type: 'string',
      hooks: {
        resolveOutput: ({ item }) => `${item.name} (${item.email})`,
      },
    }),
  },
})

// After
User: list<Lists.User.TypeInfo>({
  fields: {
    displayName: virtual({
      type: 'string',
      hooks: {
        resolveOutput: ({ item }) => `${item.name} (${item.email})`,
      },
    }),
  },
})
```

## List-Level Hooks Type Inference Fix

Fixed a critical type parameter mismatch where `Hooks<TTypeInfo>` was passing the entire TypeInfo object as the first parameter instead of properly destructuring it into three required parameters:

1. `TOutput` - The item type (what's stored in DB)
2. `TCreateInput` - Prisma create input type
3. `TUpdateInput` - Prisma update input type

**Impact:**

- `resolveInput` now receives proper Prisma input types (e.g., `PostCreateInput`, `PostUpdateInput`)
- `validateInput` has access to properly typed input data
- `beforeOperation` and `afterOperation` have correct item types
- All list-level hook callbacks now get full IntelliSense and type checking

**Example:**

```typescript
Post: list<Lists.Post.TypeInfo>({
  fields: { title: text(), content: text() },
  hooks: {
    resolveInput: async ({ operation, resolvedData }) => {
      // ✅ resolvedData is now properly typed as PostCreateInput or PostUpdateInput
      // ✅ Full autocomplete for title, content, etc.
      if (operation === 'create') {
        console.log(resolvedData.title) // TypeScript knows this is string | undefined
      }
      return resolvedData
    },
    beforeOperation: async ({ operation, item }) => {
      // ✅ item is now properly typed as Post with all fields
      if (operation === 'update' && item) {
        console.log(item.title) // TypeScript knows this is string
        console.log(item.createdAt) // TypeScript knows this is Date
      }
    },
  },
})
```

## Breaking Changes

- Field types now accept full `TTypeInfo extends TypeInfo` instead of just `TItem`
- `FieldsWithItemType` utility replaced with `FieldsWithTypeInfo`
- All field builders updated to use new type signature
- List-level hooks now receive properly typed parameters (may reveal existing type errors)

## Benefits

- ✨ Cleaner code without manual type parameter repetition
- 🎯 Better type inference in both field-level and list-level hooks
- 🔄 Consistent type flow from list configuration down to individual fields
- 🛡️ Maintained full type safety with improved DX
- 💡 Full IntelliSense support in all hook callbacks
