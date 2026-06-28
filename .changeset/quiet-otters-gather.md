---
'@opensaas/stack-core': minor
---

Add `context.transaction()` — an interactive, hook-firing transaction

You can now run multiple access-checked `context.db.*` operations atomically in one transaction while preserving the access/hook boundary (unlike raw `prisma.$transaction`, which bypasses both). The callback receives a full context whose `db.*` operations enforce access control and run list/field hooks, but persist against a single interactive transaction — so a throw anywhere rolls the whole transaction back.

Options (notably `isolationLevel`, plus `maxWait`/`timeout`) pass through to Prisma, and serialization failures (Prisma `P2034`) propagate to the caller so you own the retry loop. This makes concurrency-sensitive invariants such as a capacity gate enforceable:

```typescript
async function bookSlot(context, slotId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await context.transaction(
        async (tx) => {
          const count = await tx.db.booking.count({ where: { slotId } })
          if (count >= CAPACITY) return { booked: false }
          return { booked: true, item: await tx.db.booking.create({ data: { slotId } }) }
        },
        { isolationLevel: 'Serializable' },
      )
    } catch (err) {
      // Serialization failures propagate — retry is caller-owned.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2034') continue
      throw err
    }
  }
  throw new Error('exceeded retry budget')
}
```

Nested `context.db` writes inside the callback join the outer transaction. New `StackContext`, `TransactionOptions`, and `TransactionIsolationLevel` types are exported from `@opensaas/stack-core`. See ADR-0012.
