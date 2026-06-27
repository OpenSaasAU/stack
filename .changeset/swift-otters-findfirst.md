---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add `findFirst` to access-controlled `context.db.<list>` delegates

`findFirst` is sugar over the existing access-filtered `findMany` (`take: 1`), so
it introduces no new access surface: it applies the exact same query-access checks
and access-controlled include building as `findMany`, then returns the first
matching row or `null`. It honours the read-side silent-failure contract — an
access-denied query yields `null` rather than throwing.

```ts
// Non-unique single-row lookup
const account = await context.db.account.findFirst({
  where: { userId: '123' },
  orderBy: { createdAt: 'desc' },
})

// Narrow the single result with a query fragment
const post = await context.db.post.findFirst({
  where: { published: true },
  query: postFragment,
})
// post: ResultOf<typeof postFragment> | null
```

The CLI type generator now emits a `findFirst` method (and `<List>FindFirstArgs`
type) for each list in the generated `.opensaas/types.ts`, so migrated apps that
reach for the familiar Prisma `findFirst` pattern get full type support.
