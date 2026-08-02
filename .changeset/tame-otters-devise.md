---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add `db.indexes` to `ListConfig` for model-level composite `@@unique`/`@@index` constraints spanning two or more of a list's own fields — the multi-column case single-field `isIndexed` can't reach.

Entries name OpenSaaS field names, not raw database columns; the generator resolves a scalar field to its own name and a relationship field to its foreign key column:

```typescript
Audition: list({
  fields: {
    student: relationship({ ref: 'Student.auditions' }),
    production: relationship({ ref: 'Production.auditions' }),
  },
  db: {
    // One audition per student per production — a DB-level backstop a
    // hook's existence check alone can't provide against concurrent writes.
    indexes: [{ fields: ['student', 'production'], unique: true }],
  },
})
// Generates: @@unique([studentId, productionId])

AuthVerification: list({
  fields: { identifier: text(), createdAt: timestamp() },
  db: {
    indexes: [
      {
        fields: ['identifier', { field: 'createdAt', sort: 'desc' }],
        name: 'AuthVerification_identifier_createdAt_idx', // adopts an existing constraint name via Prisma's `map:`
      },
    ],
  },
})
// Generates: @@index([identifier, createdAt(sort: Desc)], map: "AuthVerification_identifier_createdAt_idx")
```

An entry naming an unknown field, a virtual field, a to-many relationship, or the non-FK side of a one-to-one relationship fails `pnpm generate` with an error naming the list, the entry, and the bad field, rather than being silently dropped or emitted as invalid Prisma. A config with no `db.indexes` generates byte-for-byte identical output to before this change.
