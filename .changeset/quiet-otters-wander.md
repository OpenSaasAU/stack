---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Auto-timestamps are now OFF by default; opt in with `db.timestamps`

The generator no longer appends `createdAt`/`updatedAt` to every model. This matches
Keystone 6 (which never adds them automatically) and keeps Keystone → stack migrations
non-destructive. A list opts in either by declaring the fields itself or by enabling the
new `db.timestamps` flag. See ADR-0004.

Note: this changes a long-standing default. Existing apps that relied on auto-injected
timestamps should set `db: { timestamps: true }` to keep them.

Enable globally:

```typescript
export default config({
  db: {
    provider: 'postgresql',
    timestamps: true, // re-enable auto createdAt/updatedAt for all lists
    // ...
  },
  lists: {
    /* ... */
  },
})
```

Override per list (takes precedence over the global setting):

```typescript
lists: {
  // Opt this one list out even though timestamps are on globally
  Production: list({
    fields: { name: text() },
    db: { timestamps: false },
  }),
  // Opt this one list in even though the global default is off
  Audited: list({
    fields: { name: text() },
    db: { timestamps: true },
  }),
}
```

When timestamps are enabled and a list already declares its own `createdAt`/`updatedAt`
field, the auto column is skipped for the declared field(s) so Prisma never sees a
duplicate (`P1012`):

```typescript
lists: {
  Post: list({
    fields: {
      title: text(),
      createdAt: timestamp(), // kept as declared; no duplicate auto column
    },
  }),
}
```

The decision is exposed as a pure, testable predicate `resolveListTimestamps(listConfig, dbConfig)`
from `@opensaas/stack-cli`, and `DatabaseConfig` is now re-exported from `@opensaas/stack-core`.
