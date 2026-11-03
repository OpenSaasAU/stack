---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add `db.defaults.timestamp.nativeType`, a config-wide native type for every `timestamp()` column (plugin lists and the auto `createdAt` included). A field's own `db.nativeType` wins. `updatedAt` is not affected.

```typescript
export default config({
  db: { provider: 'postgresql', defaults: { timestamp: { nativeType: 'Timestamp(3)' } } },
  lists: {},
})
```
