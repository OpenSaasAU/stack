---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

The generated context constructs the Prisma 8 client from `contract.json`

Core gains `@opensaas/stack-core/client`, whose `resolveRuntimeConnection()` chooses how the
runtime binds its connection, and the generated `.opensaas/context.ts` builds its client from it
once per process — with the stack-owned origin tripwire in `middleware` and each declared pack's
runtime façade in `extensions`.

```typescript
import { resolveRuntimeConnection } from '@opensaas/stack-core/client'

postgres<Contract>({
  contractJson,
  middleware: [originTripwire],
  ...resolveRuntimeConnection(config.db.client),
})
```

Three branches, in order:

- `db.client.pg` — your own pool. The factory is called here and nowhere else, once, after the
  config promise resolves, so loading the config (the CLI's `generate`, tooling, a type check)
  never opens a connection.
- A dev database (`opensaas dev`) — a single-connection pool with `verifyMarker: false`, both
  required by the socket-multiplexed dev database and applied on its provenance only.
- `DATABASE_URL` — the connection string and Prisma's defaults, plus `db.client.poolOptions`.

With neither a connection variable nor a running dev database, the first use throws
`DatabaseUrlUnresolvedError`, naming both remedies.
