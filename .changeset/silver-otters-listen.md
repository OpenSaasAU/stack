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
`DatabaseUrlUnresolvedError`, naming both remedies. That failure is not cached: a process that
starts before its database does drops the memo and builds a client on the next call, so the dev
server booting ahead of `opensaas dev` recovers on its own rather than serving a stale error for
the rest of its life.

An explicit `db.client.pg` still wins over a running dev database, but now says so — binding your
own pool there loses the single connection and `verifyMarker: false` that database requires, and
`resolveRuntimeConnection` warns rather than rebinding silently.
