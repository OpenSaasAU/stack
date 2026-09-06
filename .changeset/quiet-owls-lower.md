---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
'@opensaas/stack-cli': patch
---

The secured surface takes the closed Where vocabulary, lowered in one place

`context.db.<List>.where(...)` now accepts the whole vocabulary — `equals`,
`not`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte`, `contains`, the `AND`/`OR`/`NOT`
combinators, and `some`/`every`/`none` on a relation of any cardinality — plus a
new scalar-only `.orderBy()`. Everything lowers onto the ORM's predicate lambda
in one place (ADR-0055).

```typescript
const posts = await context.db.Post.where({
  OR: [{ title: { contains: 'release' } }, { views: { gte: 100 } }],
  author: { some: { handle: { equals: 'ada' } } },
})
  .orderBy({ views: 'desc' })
  .all()
```

- `contains` is engine-escaped and case-insensitive, so `contains: '50%'` matches
  a literal per-cent sign rather than binding a wildcard.
- `equals: null` lowers to `IS NULL`, `not: null` to `IS NOT NULL`.
- A relation predicate ANDs the related list's own `query` access inside the
  `EXISTS`. A related list the session cannot query is the empty set: `some` is
  false, `none` and `every` are true.
- An unknown key or operator is a `ValidationError` naming the list and the key,
  under `sudo` too. A key the session cannot read is refused with the identical
  message a key the list does not declare gets, so the refusal is not an
  existence oracle; a denied caller still gets the Silent failure first and sees
  no validation error at all.

**Lowering is now total.** A condition that resolved to `undefined` is refused
rather than dropped, on both spellings. An access rule written as
`({ session }) => ({ authorId: session?.userId })` used to match every row for an
anonymous caller; it now throws. Spell the denial:

```typescript
// Before — silently matched everything when session was null
query: ({ session }) => ({ authorId: session?.userId })

// After
query: ({ session }) => (session ? { authorId: { equals: session.userId } } : false)
```

**Also changed:** the filter engine's `FilterCondition` is a Where vocabulary
value; a to-one relationship's label filter emits `some` rather than `is`; a
to-many count filter shrinks to presence (`orders:0` → `none`, `orders:>0` /
`orders:>=1` → `some`, any other comparison degrades to free text);
`RELATIONSHIP_COUNT_FILTER_KEY`, `RelationshipCountFilterMarker`,
`resolveRelationshipCountFilters`, `resolveRelationshipLabelFilters` and
`isToOneRelationshipField` are removed; and read-path key validation rejects an
operator outside the vocabulary (`startsWith`, `endsWith`, `mode`, `search` and
the array/JSON operators are gone).
