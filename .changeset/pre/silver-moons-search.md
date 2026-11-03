---
'@opensaas/stack-core': minor
---

Add the `nearest()` vector-search terminal to the secured read surface

`context.db.<List>.where(…).nearest(field, vector, { limit, minScore })` runs one
scoped similarity query over a native `Vector(n)` column and returns
`{ item, score }`. The ranking, the `limit` and the `minScore` bound all sit
inside the query alongside the Access Filter, so top-K is computed over the rows
the session may see rather than filtered down afterwards, and the raw distance is
never exposed. Searching requires read access to the embedding field: ordering by
a vector measures its contents, so a session that cannot read it is refused with
the message an undeclared key gets.

```typescript
const hits = await context.db.Article.where({ published: true }).nearest('embedding', queryVector, {
  limit: 5,
  minScore: 0.8,
})

for (const { item, score } of hits) {
  console.log(item.title, score)
}
```

The database owns the ordering. `score` is the same distance function recomputed
from the row's own vector, in float64 over a float4 column, so two tied rows can
arrive in an order their scores do not reproduce — read it as the similarity, not
as the sort key. A column that does not read back as a vector raises
`VectorDecodeError` naming the list and field, rather than scoring `NaN`.

A field declares its vector column through the new `getVectorColumn` member of
`BaseFieldConfig`, which core reads to know the column, its dimension and the
distance function (`cosine`, `l2` or `inner_product`) — a descriptor naming any
other distance function is refused:

```typescript
getVectorColumn: (fieldName) => ({
  column: fieldName,
  dimensions: 1536,
  distanceFunction: 'cosine',
})
```
