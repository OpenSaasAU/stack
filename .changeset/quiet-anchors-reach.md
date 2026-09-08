---
'@opensaas/stack-core': minor
---

A directly-written foreign key now takes the same reachability check `connect` does, so the two spellings of one edge give the same answer (#1331).

Writing the column (`data: { authorId }`) and writing the relationship field (`data: { author: { connect: { id } } }`) are the same edge, and ADR-0050 pairs both access components with it: the owning field's write access, and query access on the target row evaluated in the database. Only the first half applied to the column, so a target the caller could not see was linked anyway, and a target that did not exist raised a database error instead — success versus an error told an invisible row from an absent one, which is the probing oracle the check exists to close.

Both spellings now run one implementation, in `lowerRelationInput`. An unreadable target and an absent one are the same silent `null` for either, `sudo` bypasses the target's `query` rule for both and the row's existence for neither, and the owning field's write access still applies first.

```typescript
// With Author.query denying this session, both are now null.
await context.db.Post.create({ data: { title: 't', author: { connect: { id } } } })
await context.db.Post.create({ data: { title: 't', authorId: id } })
```

A foreign-key column carrying something that is neither a row id nor `null` — an ORM scalar wrapper such as `{ set: … }` — is now refused with `MalformedForeignKeyInputError` rather than reaching the driver, since lowering it would write the edge without the reachability query. Like every other payload-shape refusal, it is raised before the transaction opens, so a malformed payload runs no hooks.

A payload spelling one edge both ways is refused with the new `ConflictingRelationInputError`. The generated input type is an intersection of independent optional members, so `{ author: { connect: { id: a } }, authorId: b }` type-checks; only one of the two values could reach the row, and the discarded one was still checked for reachability — so an unreadable `b` denied a write whose applied value, `a`, was perfectly reachable. Write one spelling.

```typescript
// Refused: two spellings of one edge.
await context.db.Post.create({ data: { author: { connect: { id: a } }, authorId: b } })
```
