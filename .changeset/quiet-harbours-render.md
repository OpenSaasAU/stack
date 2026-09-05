---
'@opensaas/stack-cli': minor
'@opensaas/stack-core': minor
'@opensaas/stack-auth': minor
---

`pnpm generate` emits the Prisma 8 artifact set: a Contract module, `prisma.config.ts` and the committed contract artifacts

`opensaas generate` no longer writes a Prisma schema or a generated Prisma client. It derives the contract from `opensaas.config.ts`, renders a standalone, fully literal `prisma/contract.ts`, writes a `prisma.config.ts` at the project root, shells to the pinned `prisma contract emit` for `prisma/contract.json` + `prisma/contract.d.ts`, checks the emitted relation graph against the derivation, then writes the `.opensaas/` bundle.

The Contract module imports nothing from your config — only `@prisma/orm-postgres/contract-builder`, the column-type helpers, and each pack declared in `db.extensions`:

```typescript
// prisma/contract.ts — generated
import { defineContract, nativeEnum, pg } from '@prisma/orm-postgres/contract-builder'
import pgvector from '@prisma/orm-extension-pgvector/pack'

export const contract = defineContract({ extensions: { pgvector } }, ({ field, model, rel }) => {
  // ...
})
```

`prisma.config.ts` imports each pack's `/control` façade and resolves its connection through the stack's URL lookup:

```typescript
// prisma.config.ts — generated
import { definePrismaConfig } from 'prisma/config'
import { defineConfig } from '@prisma/orm-postgres/config'
import { findDatabaseUrl } from '@opensaas/stack-core'
import pgvector from '@prisma/orm-extension-pgvector/control'

export default definePrismaConfig({
  orm: defineConfig({
    contract: './prisma/contract.ts',
    output: './prisma',
    extensions: [pgvector],
    db: { connection: findDatabaseUrl() },
  }),
})
```

Commit `prisma/contract.ts`, `prisma/contract.json` and `prisma/contract.d.ts` — a schema change is then reviewable in the PR that made it, and CI can fail on a stale artifact.

The generated `.opensaas/context.ts` constructs its client from the committed `contract.json` rather than from a generated client package:

```typescript
postgres<Contract>({ contractJson, url: resolveDatabaseUrl() })
```

Core adds `resolveDatabaseUrl()` (throws when nothing is set) and `findDatabaseUrl()` (returns `undefined`) — the one place a connection string is read from `DIRECT_DATABASE_URL` or `DATABASE_URL` — plus `resolveListTimestamps`. `output.prismaSchema` is now `output.contractModule` (default `prisma/contract.ts`), and a plugin's `afterGenerate` receives `contractModule` where it received `prismaSchema`.

`authPlugin`'s per-model `indexes` no longer document a `sort` direction on a field reference; an index column cannot carry one, and a `sort` key is refused at generation.
