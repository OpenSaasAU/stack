---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

`db.indexes` entries accept `where`, a raw SQL predicate that makes the entry a partial index (or a partial unique index with `unique: true`), so partial unique invariants are declared rather than planned away.

```typescript
db: {
  indexes: [{ fields: ['twilioSid'], unique: true, where: `("twilioSid" <> ''::text)` }],
}
```
