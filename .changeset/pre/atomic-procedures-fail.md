---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': patch
'create-opensaas-app': patch
---

A procedure can run several operations atomically and throw a named failure that rolls them back.

`run` opens no transaction of its own. Wrap the writes that must succeed together in `context.transaction`; its context is narrowed like the procedure's own (no `sudo`, `unsafe`, `withSession` or `serverAction`, at runtime as well as in the type) and keeps `.forUpdate()` and `advisoryLock`. Declare the outcomes a caller should handle in `failures`, and throw what `fail` constructs:

```typescript
import * as z from 'zod'
import { procedure } from '@/.opensaas/procedures'

export const bookSlot = procedure({
  description: 'Book a place in a slot',
  input: z.object({ slotId: z.string() }),
  output: z.object({ bookingId: z.string() }),
  failures: { SLOT_FULL: 'The slot has no places left', NO_SLOT: 'No such slot' },
  access: ({ session }) => session !== null,
  expose: ['web'],
  run: async ({ input, context, fail }) =>
    context.transaction(async (tx) => {
      const held = await tx.db.Slot.where({ id: { equals: input.slotId } })
        .forUpdate()
        .first()
      if (held === null) throw fail('NO_SLOT')

      const booking = await tx.db.Booking.create({ data: { slotId: input.slotId } })
      const slot = await tx.db.Slot.where({ id: { equals: input.slotId } }).first()
      const { taken } = await tx.db.Booking.where({ slotId: { equals: input.slotId } }).aggregate(
        (aggregate) => ({ taken: aggregate.count() }),
      )
      // Thrown after the write: the booking is rolled back.
      if (booking === null || slot === null || taken > slot.capacity) throw fail('SLOT_FULL')
      return { bookingId: booking.id }
    }),
})
```

`fail` accepts only the codes the procedure declares, so an undeclared code is a compile error, and `ProcedureResultOf<typeof bookSlot>` exposes the declared codes beside the reserved ones. Over HTTP a declared failure answers 200 with `{ success: false, error: { code, message } }`; `VALIDATION` stays 400 with field errors and `RETRY` and `CONFLICT` stay 409. Nothing retries a `RETRY` automatically: it reports that the transaction rolled back, not that work outside it was undone.

Things to know:

- `throw` a failure. One returned from `run` or from a transaction callback is treated as thrown, so it still rolls the transaction back and answers its code.
- A code is upper-case letters, digits and `_`. Declaring a reserved code (`UNAUTHENTICATED`, `DENIED`, `INVALID_INPUT`, `VALIDATION`, `RETRY`, `CONFLICT`, `INTERNAL`) is a compile error and is refused when the procedure is defined.
- Output is parsed after `run` returns, so output that fails its schema is `INTERNAL` and does not undo a transaction that already committed.
- A defined procedure's `access` and `run` now take the application context (`{ context }` and `{ input, context }`) and narrow it themselves. This only matters to code that called them directly instead of going through a host.

See ADR-0086.
