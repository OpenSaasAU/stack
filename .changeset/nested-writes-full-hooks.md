---
'@opensaas/stack-core': minor
---

Nested relation writes now run the full hook pipeline inside one transaction (#569)

A record written via a nested `create`, `update`, or `delete` now fires the SAME
list- and field-level `beforeOperation`/`afterOperation` hooks as the equivalent
top-level write — so side effects (workflows, notifications, billing) are
identical whether a record is written nested or top-level. Previously nested
writes ran only `resolveInput`/`validate`/field-rules and silently skipped the
before/after side-effect hooks.

- Nested **create** runs `beforeOperation` (create) → persist → `afterOperation`
  receiving the created `item`.
- Nested **update** runs `afterOperation` receiving both `originalItem` (the row
  before) and the updated `item`.
- Nested **delete** runs `beforeOperation`/`afterOperation` receiving the
  `originalItem`.

Existing access control, validation, silent-failure, sudo-bypass, and the #578
nested-`connect`/`connectOrCreate` read-access + DB-reachability behavior are
unchanged. Pass-through nested kinds (`disconnect`/`set`/`updateMany`/
`deleteMany`) are out of scope and behave as before. See ADR-0010.

For to-many nested creates (`create: [{A},{B}]`), each created record's
`afterOperation` now fires exactly once against its OWN distinct row, recovered
by id-diff against the rows that existed before the write — so a pre-existing
sibling is never passed as the "created" item, and multiple creates no longer
collapse to a single row.

BEHAVIOR CHANGE — every write is now transactional, and a throwing
`beforeOperation`/`afterOperation` (or validation) rolls the whole write back.
The entire operation (parent + all nested writes) now runs inside one
`prisma.$transaction`, so it is atomic. Previously an `afterOperation` that threw
left the row committed; now it rolls back with the transaction (more
Keystone-correct). If you relied on a thrown `afterOperation` leaving the row
persisted, move that work to run after the write returns.

Inside a `beforeOperation`/`afterOperation` hook, `context.db` (and
`context.prisma`) are now bound to the write's transaction, so any `context.db`
write a hook performs participates in — and rolls back with — the same
transaction. Externally-visible side effects that must survive a rollback should
not use `context.db` from within these hooks (transaction-boundary hooks for
that are deferred — see #590).

```ts
// Nested create now fires the related list's beforeOperation/afterOperation,
// atomically with the parent — a throw anywhere rolls the whole write back.
await context.db.post.update({
  where: { id },
  data: {
    title: 'Updated',
    author: { create: { name: 'New Author' } }, // User hooks fire; atomic
  },
})
```
