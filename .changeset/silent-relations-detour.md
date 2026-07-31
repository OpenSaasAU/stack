---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

**This break is silent.** A `context.db` read with no `include` (and no fragment `query`) used to auto-include every readable relationship of the list, recursing up to 5 levels deep. It now returns the row's own columns plus its virtual fields only — matching Prisma's own semantics for a bare read — and relations arrive only when you name them. A read that used to return `post.author` now returns no `author` key at all: no error, no warning, just less data (ADR-0024). This applies uniformly to `findUnique`, `findMany`, and a singleton's `get()`, under sudo and under a session alike. Foreign-key columns (e.g. `authorId`) are unaffected and always returned, so a relation stays reachable by id without an `include`.

**Detect call sites that need updating:**

- Grep for bare reads: `context.db.*.find*` calls (or a singleton's `.get()`) with no `include` and no `query` argument, whose result is later used to access a relationship field.
- Grep for `resolveOutput` hooks on `virtual` fields that read a relation off `item` (e.g. `item.author`, `item.posts`) — these silently degrade the same way, since a hook's own `context.db` read is subject to the same rule.

**Migrate** by naming the relation explicitly, either via `include`:

```typescript
// Before — relied on the auto-include
const post = await context.db.post.findUnique({ where: { id } })
post.author // used to be populated

// After — name it
const post = await context.db.post.findUnique({
  where: { id },
  include: { author: true },
})
post.author // populated
```

or via a fragment `query`:

```typescript
const post = await context.db.post.findUnique({
  where: { id },
  query: postWithAuthorFragment,
})
```

A `resolveOutput` hook that read `item.<relation>` should instead read through `context.db` with an explicit `include`, or its caller should pass one.

**Singleton `get()` gains caller-`include` support** it never had — it can now be narrowed and widened like any other read:

```typescript
const settings = await context.db.settings.get({ include: { homepage: true } })
```

Bare reads also stop evaluating operation-level `query` access on related lists (that walk previously ran for every relation at every level before fetching anything), so an access function relied on for a side effect will no longer fire on a bare read.

See `docs/adr/0024-a-read-with-no-include-fetches-scalars-not-relations.md` for the full rationale.
