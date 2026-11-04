---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add `db.defaults.timestamp.nativeType`, a config-wide native type for every `timestamp()` column (plugin lists and both auto-timestamps included). A field's own `db.nativeType` wins.

```typescript
export default config({
  db: { provider: 'postgresql', defaults: { timestamp: { nativeType: 'Timestamp(3)' } } },
  lists: {},
})
```
