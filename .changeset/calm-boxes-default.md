---
'@opensaas/stack-core': minor
---

`checkbox()` now defaults to `false` when no `defaultValue` is set, matching Keystone

Creating a row that omits a checkbox field no longer fails with a not-null `DatabaseError`; it reads back `false`. An explicit `defaultValue: true` is unchanged, and `db.isNullable: true` keeps the column nullable while still defaulting to `false`.

Migration note: existing projects get `DEFAULT false` on checkbox columns at their next migration. Existing rows are not backfilled. This also applies to boolean columns `@opensaas/stack-auth` derives without an upstream default (e.g. the MCP plugin's `skipConsent` and `requirePKCE`).
