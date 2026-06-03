---
'@opensaas/stack-auth': minor
---

Add `adoptBetterAuthTables()` recipe for adopting an existing better-auth installation

A migrating project that already runs better-auth (its `AuthUser`/`AuthSession`/`AuthAccount`/`AuthVerification` tables live in a separate `auth` Postgres schema, and its app `User` is a different model) can now adopt those live tables without rebuilding the auth config by hand. The recipe presets the plugin-level `schema` plus each model's `modelName` (and optional column `fields` maps) to the conventions of a standard separate-schema better-auth install, so the derived Auth lists diff clean (Schema parity) against the live database — no destructive auth migration. The app's own domain `User` is left untouched; linking it to the Auth identity is the application's concern.

```typescript
import { config } from '@opensaas/stack-core'
import { authPlugin, adoptBetterAuthTables } from '@opensaas/stack-auth'

export default config({
  db: { provider: 'postgresql', url: process.env.DATABASE_URL },
  plugins: [
    authPlugin({
      // Defaults: AuthUser/AuthSession/AuthAccount/AuthVerification in the
      // `auth` schema, pinned to your live table names (@@map) + schema (@@schema).
      ...adoptBetterAuthTables(),
      emailAndPassword: { enabled: true },
    }),
  ],
  lists: {
    // Your own domain User stays in `public` and is NOT touched by the plugin.
    User: list({ fields: { subjectId: text({ validation: { isRequired: true } }) } }),
  },
})

// Customise when your live tables diverge from the defaults:
adoptBetterAuthTables({
  schema: 'identity', // default: 'auth'
  modelNamePrefix: 'BA', // default: 'Auth'
  fields: { user: { name: 'full_name' }, session: { userId: 'user_id' } },
})
```
