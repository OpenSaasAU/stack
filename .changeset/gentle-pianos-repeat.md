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

Its auto-create is also tightened on a security path. `get()` previously fired
the auto-create for any `query` rule that did not answer a strict `false`, so a
rule that answered a **filter** — a first-class form, used to scope a read —
fell through it. On an absent row that created the singleton and handed it to a
session the filter excluded; on a present row it reached the singleton-create
constraint's unscoped row count and threw
`Cannot create: … is a singleton list with an existing record`, turning a read
whose whole design is silent failure into an existence oracle. The auto-create
now fires only for a rule that answered a strict `true` (or under `sudo`), and
the created row is handed back through the composed read rather than raw. Every
other form — `false`, a filter, a missing rule — answers the same `null` an
absent row answers, writes nothing, and raises nothing; a rule that throws still
propagates.

If you relied on a filter-returning `query` rule auto-creating a singleton, give
that list a `query` rule that answers `true` and scope it with the Access Filter
on the fields instead.
