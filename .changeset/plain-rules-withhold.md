---
'@opensaas/stack-core': minor
---

A field's `read` rule now denies when it reaches for a relation the row does not carry, closing a count, a `combine` of counts or an absent relation making a rule fail open.

This changes what rules see. A relation the read did not deliver whole — not included, narrowed by the caller with `where`, `limit`, `offset`, `orderBy`, `select` or a nested `include`, or reduced to counts with no rows — is withheld, and reading it denies that rule. A foreign key's rule takes the same decision on the same rows as every other rule on the row.

```typescript
const notes = relationship({
  ref: 'Note.ticket',
  many: true,
  access: { read: ({ item }) => !item.notes?.some((note) => note.private) },
})

await context.db.Ticket.include('notes').all() // decides on the rows, as before
await context.db.Ticket.include('notes', (rows) => rows.count()).all() // denies, and used to pass
await context.db.Ticket.include('notes', (rows) => rows.limit(10)).all() // denies, and used to pass
```

- A rule that throws the `TypeError` of reading it, like `item.logs.length`, denies rather than failing the read, so the admin item view renders where it showed "Item not found". The section says it can't be shown, and the list view shows no count, rather than a false empty or `0`.
- An included to-one the related list's access left out is withheld, not `null`, so `!item.owner?.banned` no longer grants under `include('owner')`. `null` on a to-one with no foreign key set is a real answer. Rules that never read a relation, like an ownership check, are unaffected.
- A rule that catches a throw from `item` is now row-dependent, so `select` and `where` can no longer open it.
- A rule that enumerates or spreads `item` denies on a row withholding any relation, and a rule that writes through `item` denies and changes nothing. Use `toSorted()` rather than `sort()` on a relation.
- Everything a rule can see of a related list is what the session can see, so never grant on an absence there. Grant on a row the session can see, or keep the fact in a column on the row. See "What a read rule sees" in the access control docs and ADR-0082.
