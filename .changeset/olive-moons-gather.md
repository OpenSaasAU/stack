---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add the Dev database primitive and give the URL lookup a provenance

`@opensaas/stack-core/dev-database` exports `startDevDatabase()`, which starts an
in-process PGlite behind a socket server on a free loopback TCP port and publishes
it in a state file (URL and pid) under the Generated bundle directory, so that the
app, a seed script and a second-terminal `db update` all find it through the same
lookup instead of an injected variable (ADR-0063). PGlite and its socket and
pgvector packages are optional peers, imported only when the primitive is called.

```typescript
import { startDevDatabase } from '@opensaas/stack-core/dev-database'

const database = await startDevDatabase({
  dataDir: '.opensaas/dev-db',
  extensions: ['vector'],
})
// ... database.url, database.port
await database.stop()
```

`stop()` is idempotent — a `SIGINT` handler and a `finally` may both call it — and drops
the state file only once the socket server and PGlite are actually released. A failure
anywhere in startup tears down whatever was already constructed, so no port is left
bound. An IPv6 `host` is bracketed into the published URL.

`resolveDatabaseUrl()` now returns `{ url, provenance }` rather than a bare string,
and consults the dev database state file when the environment names no connection.
`provenance` is `'env'` for `DATABASE_URL`/`DIRECT_DATABASE_URL` and `'dev-database'`
for the state file; with neither it throws, naming both remedies. Callers that want
just the string take `.url`; `findDatabaseUrl()`, which the generated
`prisma.config.ts` uses, is unchanged in shape and still non-throwing.

```typescript
// Before
const url = resolveDatabaseUrl()

// After
const { url, provenance } = resolveDatabaseUrl()
```
