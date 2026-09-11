---
'@opensaas/stack-core': minor
---

The nested-write access gap reported in #1384 is closed by refusal, not by gating

Nested `set`, `updateMany` and `deleteMany` under a relationship key used to
reach the database as an unchecked pass-through: the target list's access was
never consulted, no hooks ran, and an unscoped `where` could reach rows well
outside the parent's own subtree. Nested `disconnect` could name a target row
the caller could not read.

Both are closed here by ADR-0050 rather than by per-kind access machinery:
`create`, `update`, `delete`, `connectOrCreate`, `disconnect`, `set`,
`updateMany` and `deleteMany` under a relationship key are refused with
`NestedRelationInputError`. `connect` is not among them — it lowers onto a
foreign-key column the row being written owns, and survives unchanged. The
refusal is unconditional — `sudo()` does not lift it — which is strictly
stronger than the interim non-sudo-only refusal #1385 shipped on the previous
line.

Clearing an edge is `null` on the relationship field **that owns the foreign
key**. On a field that owns none — a to-many, the non-owning half of a
one-to-one, a synthetic back-relation — `null` is refused in turn with
`NonOwningRelationInputError`, exactly as `connect` is there, so clearing that
edge is an update against the target list:

```typescript
// `Author.posts` owns no column, so the write goes to `Post`:
await context.db.Post.update({ where: { id: postId }, data: { author: null } })
```

Every other refused kind is likewise a write against the target list, wrapped in
`context.transaction()` when it must land atomically.

See `rugged-terminals-persist.md` for the full write-surface change.
