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

A foreign-key column carrying something that is neither a row id nor `null` — an ORM scalar wrapper such as `{ set: … }` — is now refused with `MalformedForeignKeyInputError` rather than reaching the driver, since lowering it would write the edge without the reachability query.
