---
'@opensaas/stack-core': minor
---

Put `aggregate`, `nearest`, `combine`, `count`, `distinct`, `distinctOn`, `cursor` and `offset` on the typed read surface

These shipped on the engine's deliberately-untyped composed read alone, so a generated project could not call any of them — `context.db.Post.aggregate(…)` was `TS2339`, and the examples the previous two changesets published did not compile. They are now on `ListQuery` / `ListRefinement` with contract-derived types, the same way `select` and `include` already are.

```typescript
const { total } = await context.db.Post.where({ published: { equals: true } }).aggregate(
  (aggregate) => ({ total: aggregate.count() }),
)

const users = await context.db.User.include('posts', (posts) =>
  posts.combine({
    published: posts.where({ published: { equals: true } }).count(),
    total: posts.count(),
  }),
).all()
// each row: { …user, posts: { published: number; total: number } }

const hits = await context.db.Article.where({ published: true }).nearest('embedding', queryVector, {
  limit: 5,
  minScore: 0.8,
})
for (const { item, score } of hits) console.log(item.title, score)
```

`nearest()` reads as `{ item, score }` (`NearestMatch`), with `item` honouring the read's own `select()` and includes, and its `field` names one of the list's vector columns — a list that declares none has no callable `nearest`. `distinct`, `distinctOn` and `cursor` name this list's stored columns, so a computed field or a misspelling is a compile error rather than a runtime refusal. A relation an include reduced reads as its count — `number` for `count()`, one number per key for `combine()` — in place of the rows; `.count()` and `.combine()` appear on a to-many refinement that has composed nothing but `where()`, so `ReducedToOneIncludeError` and `UnreducibleRefinementError` are compile errors too. `Aggregations` and `CountReduction` are exported, so a builder factored out of the call site can be named.

A singleton list carries `get` and the CRUD delegate and no composed read, which is what its runtime has always done — `context.db.Settings.where/all/first/aggregate/nearest/offset/distinct/distinctOn/cursor` type-checked and threw `TypeError` before.

`offset(count)` joins the top-level read, where it previously existed on an include refinement alone. It pages inside the Access Filter, and `all()` and `first()` both honour it — `first()` has no offset of its own, so `.orderBy(…).offset(10).first()` is the eleventh row. `aggregate()` and `nearest()` refuse a composed `offset` (and `aggregate()` a composed `limit`) rather than answer a different question in silence, the way both already refuse `distinct` and `cursor`; the refusal runs after the access check, so a denied caller still gets `0` or `[]`.

Each terminal now declares what it does with every member of a resolved plan, so a member it neither applies nor refuses is a compile error rather than a silent drop.

`groupBy`, the `*All` family, `*AndCount` and `upsert` remain absent: a method appears only where the engine knows how to scope it.
