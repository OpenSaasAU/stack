---
'@opensaas/stack-core': minor
'@opensaas/stack-auth': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-rag': minor
'@opensaas/stack-ui': minor
---

`context.db` is keyed by the PascalCase list name and carries the opaque read wrapper

`context.db.<List>` is now spelled the way the config spells the list — `context.db.AuthUser`, not
`context.db.authUser` — and `getDbKey()` is deleted (`getUrlKey()` and `getListKeyFromUrl()` stay).
Every call site through the secured surface, and every ORM handle the engine reaches a model
through, moves to the list key.

```typescript
// Before
const posts = await context.db.blogPost.findMany()

// After
const posts = await context.db.BlogPost.findMany()
```

The same member is now also a query value: `.where(...)` composes an immutable read and `.all()` /
`.first()` are the terminals that run it. A terminal resolves operation-level `query` access, adds
the access filter as a second entry in the collection's own filter list (nothing is hand-merged),
enters the engine origin around the ORM call, applies Field Visibility, and returns `[]` / `null`
on denial — indistinguishable from an empty result.

```typescript
const mine = await context.db.Post.where({ published: true }).all()
const first = await context.db.Post.where({ authorId: session.userId }).first()
```

`where` takes an equality predicate (`{ column: value }` or `{ column: { equals: value } }`); an
operator the engine does not lower yet is refused rather than passed through.
