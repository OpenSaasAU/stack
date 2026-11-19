---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

Contract derivation, the constraint map and generate-time field-name validation read names and foreign-key ownership from the List member table; the contract is unchanged.
A `db.indexes`/`db.foreignKeys` entry naming a field with a `computed` descriptor is now refused by name at generate.
