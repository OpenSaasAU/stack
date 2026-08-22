---
'@opensaas/stack-core': patch
---

`relationship({ ref: 'ListName' })` list-only refs now accept `db.foreignKey: { map: '...' }` to rename the foreign key column. The boolean form (`true`/`false`) is still rejected there since ownership is implicit on a list-only ref.
