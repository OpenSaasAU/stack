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

A pack that does not publish one of the three subpaths fails generation naming the pack and the exact missing subpath, and it fails before anything is written — `prisma.config.ts` is never left carrying an import that cannot resolve. A pack whose `/control` subpath loads but default-exports no control descriptor is refused the same way, naming the pack and the subpath rather than failing as a `TypeError` from inside the seed phase.

Subpaths are resolved under the `import` condition, the same way the generated artifacts reach them, so an ESM-only pack is accepted and a dual-published pack is loaded from its ESM build. Overlapping `exports` patterns are ranked the way Node ranks them, and a directory at a subpath is not treated as a resolution — ESM cannot import one.
