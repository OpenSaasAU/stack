---
'@opensaas/stack-cli': minor
---

`opensaas generate` seeds each declared extension pack's contract space under `migrations/`

Every `db.extensions` entry now has its `/pack`, `/control` and `/runtime` subpaths derived from the package name and checked, and its migration package, head ref and contract snapshot materialised under `migrations/` — between writing `prisma.config.ts` and emitting the contract (ADR-0065). Seeding opens no database connection; the space's content is a function of the installed pack version alone.

```typescript
// opensaas.config.ts
export default config({
  db: {
    provider: 'postgresql',
    extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
  },
  lists: {/* ... */},
})
```

`pnpm generate` then writes, and reports, the pack's space:

```
✅ pgvector: migrations/pgvector updated
```

```
migrations/pgvector/20260601T0000_install_vector_extension/migration.json
migrations/pgvector/20260601T0000_install_vector_extension/ops.json
migrations/pgvector/refs/head.json
migrations/snapshots/<hash>/contract.json
migrations/snapshots/<hash>/contract.d.ts
```

Commit these files. A second `generate` leaves them byte-identical and reports the space `unchanged`; upgrading the pack to a version shipping a new migration package rewrites the head ref, so the upgrade surfaces as a generate diff rather than a silent drift. Prisma then runs `CREATE EXTENSION IF NOT EXISTS` from the committed space on `db init`, `db update` and `db migrate` — there is no hand-run DDL step.

A pack that does not publish one of the three subpaths fails generation naming the pack and the exact missing subpath.
