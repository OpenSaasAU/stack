---
'@opensaas/stack-cli': minor
---

Improve KeystoneJS migration guidance for virtual fields and context.graphql patterns

The Keystone migration guide now covers two areas that require changes beyond a simple import swap:

**Virtual fields** — detected automatically; the generated guide shows how to replace `graphql.field({ resolve })` with `hooks: { resolveOutput }` and a `type` declaration:

```diff
- fullName: virtual({
-   field: graphql.field({
-     type: graphql.String,
-     resolve: (item) => `${item.firstName} ${item.lastName}`,
-   }),
- })
+ fullName: virtual({
+   type: 'string',
+   hooks: {
+     resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
+   },
+ })
```

**context.graphql calls** — the guide now includes a step showing how to replace `context.graphql.run()` and `context.query.*` with `context.db.{listName}.{method}()`:

```diff
- const { posts } = await context.graphql.run({
-   query: `query { posts(where: { status: { equals: published } }) { id title } }`,
- })
+ const posts = await context.db.post.findMany({
+   where: { status: { equals: 'published' } },
+ })
```

The introspector warning for virtual fields is also updated to give clearer guidance.
