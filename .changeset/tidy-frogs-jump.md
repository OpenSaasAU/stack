---
'@opensaas/stack-auth': minor
---

Add a `betterAuthOptions` escape hatch on `AuthConfig` for better-auth options the stack doesn't model, plus an exported `buildBetterAuthOptions()` builder for apps that still need to hand-wire their own `betterAuth()` instance.

`betterAuthOptions` is deep-merged onto the options `createAuth()` builds, applied last — a plain-object value merges recursively alongside sibling keys the stack already set (e.g. `session: { cookieCache }` doesn't clobber `session.expiresIn`), and wins on any genuine key collision:

```typescript
authPlugin({
  betterAuthOptions: {
    databaseHooks: { user: { create: { after: syncDomainUser } } },
    session: { cookieCache: { enabled: true, maxAge: 300 } },
    verification: { storeIdentifier: 'hashed' },
    baseURL: process.env.BETTER_AUTH_URL,
  },
})
```

`database`, `plugins`, and `additionalFields` under `user`/`session`/`account`/`verification` are rejected — they already have dedicated seams (`db` config, `betterAuthPlugins`), or have schema consequences a passthrough can't also apply to the generated Prisma schema.

`buildBetterAuthOptions(config, context)` returns the exact same options object `createAuth()` uses, for apps that need a resolved `betterAuth()` instance rather than `createAuth()`'s lazy proxy:

```typescript
import { betterAuth } from 'better-auth'
import { buildBetterAuthOptions } from '@opensaas/stack-auth/server'

export const auth = betterAuth({
  ...(await buildBetterAuthOptions(config, rawOpensaasContext)),
  databaseHooks: { user: { create: { after: syncDomainUser } } },
})
```
