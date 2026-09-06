---
'@opensaas/stack-core': major
---

BREAKING: `.select()` is honoured exactly, and the fragment API is deleted

A read on the secured surface is narrowed with `.select(...fields)`, which the
engine honours exactly: it widens the query by the declared dependency sets of
the computed fields the read will return and by anything a row-dependent field
`read` rule has to see, then strips `widened ∖ caller` as a recursive set
difference at every nesting level. `.select()` replaces on call rather than
accumulating, names this list's own fields only, and a computed field is
selectable whether or not the columns it reads were named. An `.include()`
refinement carries its own `.select()`.

```typescript
// `wordCount` declares `needs: ['body']`. The engine reads `body`, computes the
// field, and `body` is not in the result — the caller did not ask for it.
const rows = await context.db.Post.select('wordCount')
  .include('author', (author) => author.select('name'))
  .all()
```

Relation-valued `needs` are now folded into the read on the new terminals, so
`.all()` / `.first()` and the legacy read path agree on a computed field with a
relation dependency.

Two behaviours change on every read path, per ADR-0051:

- **A `resolveOutput` hook's `item` is exactly its own declared dependency set
  plus the list's system fields.** A hook that reads a key it did not declare in
  `needs` now finds nothing there. Migration: find `resolveOutput` hooks whose
  `item` reads a key absent from that field's `needs`, and declare it.
- **A declaration outranks a caller-facing `read` denial** on the same column or
  relation. The value reaches the hook and is still stripped before the caller
  sees it, so adding a `read` rule elsewhere can no longer silently change a
  computed field's value — and `needs: ['passwordHash']` is a deliberate way to
  surface a denied column's derived value.

`defineFragment`, `runQuery`, `runQueryOne`, `ResultOf`, `RelationSelector`,
`QueryArgs`, `Fragment`, `FieldSelection`, `buildInclude`, `pickFields` and the
`query:` argument on `findMany` / `findFirst` / `findUnique` are removed.

Migration:

```typescript
// Before
const postFragment = defineFragment<Post>()({ id: true, title: true } as const)
const posts = await context.db.post.findMany({ query: postFragment, where: { published: true } })

// After
const posts = await context.db.Post.where({ published: { equals: true } })
  .select('title')
  .all()
```

A nested fragment or `RelationSelector` becomes an `.include()` refinement:

```typescript
// Before
defineFragment<Post>()({
  id: true,
  comments: { query: commentFragment, where: { approved: true }, take: 5 },
} as const)

// After
context.db.Post.select('title').include('comments', (comments) =>
  comments
    .where({ approved: { equals: true } })
    .limit(5)
    .select('body'),
)
```
