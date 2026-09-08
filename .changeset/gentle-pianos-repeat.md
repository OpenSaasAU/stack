---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
'@opensaas/stack-auth': minor
'@opensaas/stack-cli': minor
---

Remove `findMany` / `findFirst` / `findUnique` / `count` from the generated read surface

The Prisma 7 read names outlived the client that could serve them: every one of
them type-checked and then threw `TypeError: … is not a function`, under `sudo`
too. Reaching for one is now a compile error rather than a runtime failure.

```typescript
// Before
const posts = await context.db.Post.findMany({ where: { published: { equals: true } } })
const post = await context.db.Post.findUnique({ where: { id } })
const first = await context.db.Post.findFirst({ where: { slug: { equals: slug } } })
const total = await context.db.Post.count()

// After
const posts = await context.db.Post.where({ published: { equals: true } }).all()
const post = await context.db.Post.where({ id }).first()
const first = await context.db.Post.where({ slug: { equals: slug } }).first()
const { total } = await context.db.Post.aggregate((aggregate) => ({ total: aggregate.count() }))
```

A singleton's `get()` is unchanged in shape and now resolves through the same
composed read an ordinary list reads through, so its operation access, Access
Filter, Field Visibility and related-list `query` access are the engine's rather
than a second copy of them.
