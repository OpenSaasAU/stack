---
'@opensaas/stack-auth': minor
---

Add a `rateLimit.storage` option to `authPlugin`. Setting it to `'database'` derives a fifth `RateLimit` Auth list, mirroring better-auth's own database-backed rate limiter table (`key`/`count`/`lastRequest`, no timestamps, no defaults) so an app that wants a persisted limiter no longer has to hand-write the model.

```typescript
authPlugin({
  rateLimit: {
    enabled: true,
    storage: 'database',
  },
})
```

`rateLimit` also carries the same `modelName`/`fields`/`tableName`/`schema` adoption knobs as the other four models, so an app with an existing limiter table can adopt it. `access.rateLimit` grants access to the derived list (closed by default, per ADR-0013). `adoptBetterAuthTables({ rateLimit: true })` adopts an existing database-backed limiter table alongside the other four. Setting `rateLimit.storage` via the `betterAuthOptions` passthrough is now rejected — use the first-class option instead.
