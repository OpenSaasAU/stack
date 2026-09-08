---
'@opensaas/stack-core': minor
---

MCP's `fields` projection is a translator onto the secured surface

The `query` tool's `fields` argument keeps the wire shape it has always had, and now lowers onto the secured read instead of a Prisma `include` bag that MCP trimmed by hand afterwards. Root scalars and virtuals become one `.select()` with `id` forced at every level; a relation becomes one `.include()` refinement carrying its own selection, `where`, `orderBy` and per-parent page under the standing nested caps; and `count: true` becomes a single `combine({ items, count })` — one include, one correlated subquery, and the `{ items, count }` shape the tool already returned, reduced to the bare number when the caller asked for the count alone. The count is taken off the unpaged relation, so it counts the relation rather than the page beside it.

A projected row now also carries `createdAt` and `updatedAt` alongside `id`, whether or not the caller named them. They are system fields, always readable and outside access control, and MCP gets them because a projected row is the engine's to shape rather than something MCP trims afterwards.

Negative `take` and `skip` are refused at the root of the `query` tool as they already were inside a relation entry, rather than reaching the driver.

`where` and `orderBy`, at the root and inside a relation entry, are the Where vocabulary, and the tools' schema descriptions say which operators that is:

```jsonc
{
  "where": { "title": { "contains": "release" }, "comments": { "some": { "approved": true } } },
  "orderBy": { "title": "asc" },
  "fields": {
    "title": true,
    "comments": {
      "fields": { "body": true },
      "where": { "approved": true },
      "take": 5,
      "count": true,
    },
  },
}
```

The `query`, `update` and `delete` tools' `where.id` is typed from the list's own id strategy: an `int autoincrement` list advertises an integer, takes `"3"` off the wire as `3`, and answers a malformed id exactly as a missing row is answered.

`pickFields`, the MCP field-selection type, `projectMcpResult` and the `_count` folding are gone — the engine's exact selection is the only authority on what a caller receives, and the projection module does no post-query trimming of its own.

A relation's rows may now be `combine`d beside a reducer on the secured surface — `include('posts', (posts) => posts.combine({ items: posts.limit(5), total: posts.count() }))` — with those rows going through Field Visibility exactly as an unreduced relation's do. At most one branch may be the rows.
