---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

`connect` on the foreign-key-owning field, with `null` as its counterpart

A write payload's `field: { connect: { id } }` is lowered onto the column the
row actually carries. The terminal issues the reachability query first — the
target list's `query` access ANDed with the identity criterion — then writes
the scalar foreign key, both inside the terminal's origin. `field: null`
clears the same column, which is what replaces nested `disconnect`
(ADR-0050). `RelationInputNotLoweredError`, the placeholder refusal, is gone.

```typescript
await context.db.Post.create({ data: { title: 'Hello', author: { connect: { id: userId } } } })
await context.db.Post.update({ where: { id }, data: { author: null } })
```

An unreadable target and one that does not exist are the same answer: the
write returns `null`, with no error and nothing written, so a foreign key
cannot become a probing oracle.

Three refusals name what a payload may carry on a relationship key:

- `NonOwningRelationInputError` — relation input on a field that owns no
  foreign key (an inverse to-many, the non-owning half of a one-to-one, a
  junction list's inverse, a synthetic back-relation). The generated input
  types carry no member for those, so this is the runtime half of a compile
  error.
- `MalformedRelationInputError` — an owning field carrying neither
  `{ connect: { id } }` nor `null`.
- `RelationTargetMissingError` — a `connect` whose ref names a list the config
  does not declare.

The relationship table's remove control follows the same rule: removing a row
through a to-one back-reference assigns `null` to it and the row survives,
while removing a junction row deletes it under that list's own delete access.

A relationship whose foreign key lives on the related row — a to-many, or the
non-owning half of a one-to-one — is not writable through the surfaces that
carry a payload for a single row, so neither surface offers it any more:

- The admin item form renders it read-only, stating that the related record
  holds the link, instead of a picker whose selection had nowhere to go.
- The MCP create/update tools omit it from the advertised `data` properties,
  so a client cannot spell a call that could only fail.

On the end that does hold the column, the MCP schema now advertises `null`
alongside `connect`, so both spellings of an edge the engine accepts are
describable through the tool surface.
