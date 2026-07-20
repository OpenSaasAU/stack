---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Admin list view: to-many relationship columns render an access-visible count, sort by relation count, and filter by numeric count comparisons (issue #732). Virtual fields render via their Cell but are excluded from sorting and filtering.

A to-many relationship used as a list column now shows the count of the related rows the session may see — fetched in the SAME query via a filtered Prisma `_count`, with the related list's `query` access folded into the count's `where`, so it never counts rows the session cannot read and issues no per-row query. Clicking the column header sorts by relation `_count`, and its Filter spec offers numeric comparisons on the count (`posts:>5`) in the filter builder and in shared URLs.

Because Prisma cannot compare a relation count in a `where`, a to-many relationship's Filter spec emits a structured count marker that is resolved to an access-scoped `{ id: { in } }` before the query runs, through the secured context.

New `@opensaas/stack-core` exports: `buildRelationshipCountSelect`, `resolveRelationshipCountFilters`, `isToManyRelationshipField`, and `RELATIONSHIP_COUNT_FILTER_KEY` (with the `RelationshipCountFilterMarker` type).

```ts
// A to-many relationship column now shows an access-scoped count and is
// sortable / filterable by that count — zero config:
User: list({
  fields: {
    name: text(),
    posts: relationship({ ref: 'Post.author', many: true }),
  },
})
// List view: the `posts` column renders the count; its header sorts by count;
// `posts:>5` filters by count in the builder and in a shared URL.
```
