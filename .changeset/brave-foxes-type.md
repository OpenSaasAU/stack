---
'@opensaas/stack-cli': minor
---

Add `createMany` and `updateMany` types to generated type definitions

The type generator now includes properly typed `createMany` and `updateMany` methods in the `CustomDB` type, matching the implementation added in PR #315.

```typescript
// createMany - bulk create with full type safety
const posts = await context.db.post.createMany({
  data: [
    { title: 'Post 1', content: 'Content 1' },
    { title: 'Post 2', content: 'Content 2' },
  ],
  select: { id: true, title: true },
})

// updateMany - bulk update with where filter
const updated = await context.db.post.updateMany({
  where: { status: 'draft' },
  data: { status: 'published' },
})
```

Also fixes hook types to use locally defined `BaseContext` instead of importing `AccessContext` from core, giving hooks access to the properly typed `CustomDB` with virtual fields and all operations.
