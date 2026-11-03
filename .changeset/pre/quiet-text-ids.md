---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-auth': patch
---

Add a `db.idField: 'cuid'` strategy for adopting a live database whose ids are `text` holding cuid v1 values. The column stays `text`, new rows get cuid2 values, and the id boundary accepts both cuid shapes, so no id or foreign-key column is altered.

```typescript
export default config({ db: { provider: 'postgresql', idField: 'cuid' }, lists: {} })
```
