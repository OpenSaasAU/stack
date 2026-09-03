---
'@opensaas/stack-core': minor
---

Core derives the Prisma 8 contract from the config (ADR-0057)

`deriveContract(config)` turns a resolved config into plain contract data — models with columns from each field builder's structured descriptor, ids by `db.idField` strategy (a singleton derives an integer id defaulting to 1), `temporal` auto-timestamps, `db.indexes` resolved to columns with named entries as `name:`, the relation graph with foreign-key ownership, the one-to-one pair (owning column + foreign key + unique constraint + `belongsTo`; inverse `hasOne`), synthetic back-relations for list-only refs, native enums and the declared extension packs. `assertRelationGraphAgrees(derived, emitted)` checks an emitted contract against that graph and throws `RelationGraphDivergenceError` naming the first divergence.

`@opensaas/stack-core/contract` adds `buildPrismaContract(data, { packs })`, which feeds the data into Prisma's contract builder in-process, and `toEmittedContract(contract)` for its JSON form:

```typescript
import { deriveContract, assertRelationGraphAgrees } from '@opensaas/stack-core'
import { buildPrismaContract, toEmittedContract } from '@opensaas/stack-core/contract'
import pgvector from '@prisma/orm-extension-pgvector/pack'

const data = deriveContract(config)
const contract = buildPrismaContract(data, { packs: { pgvector } })
assertRelationGraphAgrees(data, toEmittedContract(contract))
```

A stored field typed by an extension pack that `db.extensions` does not declare is now a generate-time refusal (`undeclared-extension-pack`) naming the list, the field and the pack; `validateExtensionPacks` is exported and runs as part of `validateDatabaseConfig`.
