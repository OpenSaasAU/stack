---
'@opensaas/stack-auth': minor
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Derive the auth plugin's Auth lists from the better-auth config

`authPlugin` now mirrors the better-auth config a developer writes instead of hardcoding the keys `User`/`Session`/`Account`/`Verification`. Per-model `modelName` becomes the OpenSaaS list key (and a table `@@map`), and the `fields` column map becomes per-field `@map`s. The plugin only ever adds/extends its own derived keys, so an app's separate domain `User` is never overwritten. The runtime `getUser`/`getCurrentUser` helpers now resolve the user list key from the configured user model instead of a hardcoded `'user'`.

Default behaviour (no overrides) is unchanged: the lists are still keyed `User`/`Session`/`Account`/`Verification` with the original field shapes and no `@@map`.

```typescript
// Adopt existing better-auth tables without a destructive migration
authPlugin({
  user: { modelName: 'AuthUser', fields: { name: 'full_name' } },
  session: { modelName: 'AuthSession', fields: { userId: 'user_id' } },
  account: { modelName: 'AuthAccount' },
  verification: { modelName: 'AuthVerification' },
})
// -> lists keyed AuthUser/AuthSession/AuthAccount/AuthVerification
//    with @@map + column @map matching the live tables
```

Lists also gain a model-level `db.map` option, which emits a `@@map("...")` on the generated Prisma model so a list key can differ from its physical table name.
