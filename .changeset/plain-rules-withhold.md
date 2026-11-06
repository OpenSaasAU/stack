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

- A rule that throws because of it, like `item.logs.length`, denies rather than failing the read, so the admin item view renders where it showed "Item not found".
- `null` on a fetched to-one is not withheld, and neither is a scalar column. Rules that never read a relation, like an ownership check, are unaffected.
- A rule that enumerates or spreads `item` denies on a row withholding any relation, and a rule that writes through `item` denies and changes nothing. Use `toSorted()` rather than `sort()` on a relation.
- A rule that needs the rows on every read issues its own `context.db` read. See ADR-0082.
