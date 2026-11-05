---
'@opensaas/stack-core': minor
---

Add `@opensaas/stack-core/testing`: a real, fully secured context over an in-process Postgres

`createTestDatabase(config)` derives the contract from a config, seeds every declared
extension pack's contract space, applies the schema once through the control client's
`dbUpdate`, and binds a single-connection Prisma 8 client with the stack's own
`originTripwire` installed. `createTestContext(config, session)` is the single-call form.
No test fakes the secured surface.

```typescript
import { createTestDatabase, createPlanRecorder } from '@opensaas/stack-core/testing'

const recorder = createPlanRecorder()
let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase(config, { middleware: [recorder.middleware] })
}, 60_000)
afterAll(async () => await db.close())
beforeEach(async () => await db.truncate())

test('the engine scopes the read', async () => {
  const context = db.context({ userId: 'user-1' })
  // …
  expect(recorder.plans.map((plan) => plan.origin)).toEqual(['engine'])
})
```

The map the engine reaches models through is checked as the harness builds it: a client
exposing no collection for a model the contract declares throws
`OrmCollectionMissingError`, naming the model, the namespace and the keys actually
present, rather than building a context that would refuse every operation later.

Set `DATABASE_URL` to a Postgres server and the identical suite runs there, each file in a
database of its own, named `opensaas_test_<YYYYMMDDHHMMSS>_<uuid>` after the exported
`ESCAPE_DATABASE_PREFIX` so a run killed before `close()` leaves orphans that are
identifiable by age and sweepable; set to anything else the variable is refused by name
rather than dialled. `readDatabaseEscape()` lets a test whose guarantee PGlite cannot
exercise skip visibly when the escape is unset.

PGlite, `@electric-sql/pglite-socket`, `@electric-sql/pglite-pgvector` and
`@prisma/orm-toolchain` are optional peer dependencies, and `pg` — a real dependency of
core, for `@opensaas/stack-core/client` — is imported lazily here too. Every one of them
is loaded on demand by this subpath only, so a production install carries no WASM
Postgres.
