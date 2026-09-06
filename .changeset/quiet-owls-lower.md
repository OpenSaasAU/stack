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
- A relation predicate scopes the `EXISTS` by the related list's own `query`
  access. `some` and `none` ask about the rows the caller may see; `every` asks
  whether every row the caller may see matches, so a row the caller cannot see
  never decides the parent's membership. A related list the session cannot
  query is the empty set: `some` is false, `none` and `every` are true.
- An Access Filter that scopes by a relation is expanded into the related list's
  own Access Filter. A filter that expands into itself — directly, or through
  another list — throws `AccessFilterRecursionError` naming the chain, rather
  than recursing until the process runs out of memory. An acyclic chain deeper
  than ten lists is refused the same way. Failing closed is deliberate: a
  truncated Access Filter is a widened read.
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

The same refusal now covers the clause `mergeFilters` folds in, so the guarantee
holds on every surface rather than only on `.where().all()/.first()`: an access
filter carrying an `undefined` condition anywhere (including nested under an
operator or inside an `AND`/`OR` branch) throws the new, exported
`UndefinedAccessFilterError`. A caller's own `where` is untouched — this applies
only to what an access rule returns.

**Also changed:** the filter engine's `FilterCondition` is a Where vocabulary
value; a to-one relationship's label filter emits `some` rather than `is`; a
to-many count filter shrinks to presence (`orders:0` → `none`, `orders:>0` /
`orders:>=1` → `some`, any other comparison degrades to free text);
and read-path key validation rejects an operator outside the vocabulary
(`startsWith`, `endsWith`, `mode`, `search` and the array/JSON operators are
gone).

**Removed exports.** These have no replacement — the behaviour they carried is
either gone or now expressed in the Where vocabulary:

| Removed                                       | What to do instead                                             |
| --------------------------------------------- | -------------------------------------------------------------- |
| `RELATIONSHIP_COUNT_FILTER_KEY`               | Nothing — the count-filter marker no longer exists.            |
| `RelationshipCountFilterMarker`               | Nothing — same.                                                |
| `resolveRelationshipCountFilters`             | Nothing — a count filter shrinks to `some`/`none` when parsed. |
| `resolveRelationshipLabelFilters`             | Nothing — a to-one label filter emits `some` directly.         |
| `isToOneRelationshipField`                    | Read `many` off the relationship field config.                 |
| `ColumnEquality`, `UnsupportedPredicateError` | Gone with the predicate builder they belonged to.              |

**Newly exported:** `UndefinedAccessFilterError` and, from the secured surface,
`AccessFilterRecursionError`.
