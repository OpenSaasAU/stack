---
'@opensaas/stack-auth': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-core': patch
---

Let an application declare model-level indexes (`db.indexes`) on the derived auth lists (`User`/`Session`/`Account`/`Verification`/`RateLimit`).

Each per-model block in `authPlugin()` now accepts `indexes`, in the same shape as a list's own `db.indexes`:

```typescript
authPlugin({
  // Adopt a live constraint's real name instead of Prisma's derived one.
  user: { indexes: [{ fields: ['email'], unique: true, name: 'user_email_key' }] },
  session: { indexes: [{ fields: ['token'], unique: true, name: 'session_token_key' }] },
  // Extend a derived column into a composite index.
  verification: {
    indexes: [{ fields: ['identifier', { field: 'createdAt', sort: 'desc' }] }],
  },
})
```

An entry covering a column the stack already derives an index for (e.g. `User.email`) suppresses that derived index for that column and emits only the app's entry, rather than erroring — the application's declaration wins (ADR-0035). Suppression is per-column: every other derived index on the model is unaffected.

This also fixes a related generator gap: a list's `db.indexes` can now reference `createdAt`/`updatedAt` even when the list has no explicit field for them and relies on `db.timestamps` for the auto-injected columns (previously only a list with an explicitly declared `createdAt`/`updatedAt` field could be indexed on it).
