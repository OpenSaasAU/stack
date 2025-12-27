---
'@opensaas/stack-core': minor
---

Add `createMany` and `updateMany` batch operations to `context.db`

You can now use `createMany` to create multiple items at once:

```typescript
await context.db.billItem.createMany({
  data: [
    { billId: '1', name: 'Item 1', quantity: 2, amount: 100 },
    { billId: '1', name: 'Item 2', quantity: 1, amount: 50 },
    { billId: '1', name: 'Item 3', quantity: 3, amount: 75 },
  ],
})
```

And `updateMany` to update multiple items based on a filter:

```typescript
await context.db.bill.updateMany({
  where: { id: { in: ['1', '2', '3'] } },
  data: { status: 'PAID' },
})
```

Both methods run individual operations in a loop to ensure all hooks and access control rules are properly executed for each item, maintaining data integrity and security.
