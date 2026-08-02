---
'@opensaas/stack-core': minor
---

Naming a relation in an `include` now fetches only that relation's own columns and stops, at every level — not just the root. This completes ADR-0024 (a bare read fetches scalars, never relations): reaching a relation's own relations means naming them too, e.g. `include: { author: { include: { organization: true } } }` rather than relying on `include: { author: true }` to pull `organization` in automatically. A relation nobody named (caller `include`, fragment `query`, or a field's `needs`) never has its list's operation-level `query` access evaluated at all.

**This is a silent break — detect it before you upgrade.** An `include` that named a relation bare and read past it (`item.<named>[0].<unnamed>`) now gets `undefined` for the unnamed part, with no error. Grep your codebase for `include: {` calls whose consumers read a second hop off a bare-named relation, and add the deeper relation explicitly:

```typescript
// Before: relied on `author` auto-expanding its own `organization` relation
const post = await context.db.post.findUnique({
  where: { id },
  include: { author: true },
})
post.author.organization // silently undefined now

// After: name the relation you actually need
const post = await context.db.post.findUnique({
  where: { id },
  include: { author: { include: { organization: true } } },
})
post.author.organization // present
```

`AccessScopeDepthExceededError` (thrown when an `include` names a relation past `READ_INCLUDE_MAX_DEPTH`) keeps its type, fields, and throw sites — only its message wording changed, from describing an inability to scope to describing a cost refusal, since the depth cap is now a cost limit rather than a security boundary (nothing walks the relationship graph unprompted anymore).
