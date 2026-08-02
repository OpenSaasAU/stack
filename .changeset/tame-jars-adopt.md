---
'@opensaas/stack-auth': minor
---

Add a per-model `tableName` option, independent of `modelName`, so a renamed Auth list key can still adopt a differently-named live table — most commonly better-auth's own default lowercase table names (`user`, `session`, `account`, `verification`).

```typescript
authPlugin({
  user: { modelName: 'AuthUser', tableName: 'user' },
  session: { modelName: 'AuthSession', tableName: 'session' },
})
```

`adoptBetterAuthTables()` gains matching `useBetterAuthTableNames` and `tableNames` options:

```typescript
adoptBetterAuthTables({ useBetterAuthTableNames: true })
// or explicitly:
adoptBetterAuthTables({ tableNames: { user: 'user', session: 'session' } })
```

With no `tableName` set, behaviour is unchanged: the table name still follows `modelName` when it differs from the better-auth default, otherwise no `@@map` is emitted.
