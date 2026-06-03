---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-auth': minor
---

Add `authPlugin` schema placement so Auth lists can adopt an existing non-`public` better-auth layout (clean-diff adoption)

The auth lists can now be placed in a non-`public` Postgres schema (e.g. `auth`) so they diff CLEAN against a separate-schema better-auth installation. A plugin-level `schema` option applies `@@schema(...)` to all generated Auth lists, with a per-list override.

```typescript
authPlugin({
  schema: 'auth', // all Auth lists get @@schema("auth")
  user: { modelName: 'AuthUser' },
  session: { modelName: 'AuthSession' },
  account: { modelName: 'AuthAccount' },
  // per-model override: relocate one list to a different schema
  verification: { modelName: 'AuthVerification', schema: 'auth_internal' },
})
```

The plugin's `beforeGenerate` hook wires the datasource `schemas` array (always including `public`) and defaults any list without an explicit `db.schema` to `public`, producing a valid multi-schema Prisma schema. With no `schema` option the output is unchanged (greenfield default stays in `public`, no `@@schema`).

Core support added for this (mirroring the `db.map` → `@@map` work):

- List-level `db.schema` → the Prisma generator emits `@@schema("...")` on the model.
- Database-level `db.schemas` → the generator emits the datasource `schemas = [...]` array and enables the `multiSchema` preview feature.

```typescript
// Core/generator building blocks
db: { provider: 'postgresql', schemas: ['public', 'auth'] }
AuthUser: list({ fields: { ... }, db: { map: 'AuthUser', schema: 'auth' } })
// Generates: model AuthUser { ... @@map("AuthUser") @@schema("auth") }
```
