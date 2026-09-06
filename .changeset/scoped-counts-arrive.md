---
'@opensaas/stack-core': minor
---

Add `aggregate`, include count reducers, `combine`, `distinct`/`distinctOn` and `cursor` to the secured read surface

`aggregate` counts only the rows the session may see, so a count always equals the length of the same session's `.all()`. A denied read answers `0` under every key rather than throwing — the empty value of a count's type, indistinguishable from a genuinely empty scoped set.

```typescript
const { total } = await context.db.Post.where({ published: { equals: true } }).aggregate(
  (aggregate) => ({ total: aggregate.count() }),
)
```

An include refinement can reduce a to-many relation to a count, scoped by both the related list's `query` access and the relationship field's own `read` rule. `combine` holds several counts over one relation, each its own independently scoped subquery:

```typescript
const users = await context.db.User.include('posts', (posts) =>
  posts.combine({
    published: posts.where({ published: { equals: true } }).count(),
    total: posts.count(),
  }),
).all()
// each row: { …user, posts: { published: number; total: number } }
```

`distinct(...fields)`, `distinctOn(...fields)` and `cursor(values)` join the read subset. Every column they name goes through the same read gate a `where` key does, so a field this session cannot read is refused exactly as an undeclared one is; `distinctOn` and `cursor` require a prior `orderBy`.

`groupBy`, the `*All` family, `*AndCount` and `upsert` remain absent from the surface: a method appears only where the engine knows how to scope it.
