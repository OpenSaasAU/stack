---
'@opensaas/stack-core': minor
---

Core derives the Prisma 8 contract from the config (ADR-0057)

`deriveContract(config)` turns a resolved config into plain contract data — models with columns from each field builder's structured descriptor, ids by `db.idField` strategy (a singleton derives an integer id defaulting to 1), `temporal` auto-timestamps, `db.indexes` resolved to columns with named entries adopted as exact constraint names, the relation graph with foreign-key ownership, the one-to-one pair (owning column + foreign key + unique constraint + `belongsTo`; inverse `hasOne`), synthetic back-relations for list-only refs, native enums, the namespaces beyond `public` (`db.schemas` unioned with every list's `db.schema`) and the declared extension packs. `assertRelationGraphAgrees(derived, emitted)` checks an emitted contract against that graph and throws `RelationGraphDivergenceError` naming the first divergence.

`@opensaas/stack-core/contract` adds `buildPrismaContract(data, { packs })`, which feeds the data into Prisma's contract builder in-process, and `toEmittedContract(contract)` for its JSON form:

```typescript
import { deriveContract, assertRelationGraphAgrees } from '@opensaas/stack-core'
import { buildPrismaContract, toEmittedContract } from '@opensaas/stack-core/contract'
import pgvector from '@prisma/orm-extension-pgvector/pack'

const data = deriveContract(config)
const contract = buildPrismaContract(data, { packs: { pgvector } })
assertRelationGraphAgrees(data, toEmittedContract(contract))
```

`db.nativeType` is honoured for every Postgres constructor the contract can express — `Text`, `VarChar(n)`, `Char(n)`, `Uuid`, `Integer`, `SmallInt`, `BigInt`, `Decimal(p, s)`, `DoublePrecision`, `Real`, `Boolean`, `Date`, `Timestamp(p)`, `Timestamptz(p)`, `Time(p)`, `Json`, `JsonB`, `ByteA` — each lowering to its own column (`Real` is `float4`, `Json` is `json` as distinct from the `jsonb` a `json()` field defaults to, and a precision reaches the DDL). A spelling outside that list, a wrong argument count (`VarChar` with no length) or a precision outside 0–6 is a generate-time error naming the list and field; nothing is silently aliased or dropped. `decimal()` now forwards `db.nativeType` like every other scalar builder.

A single-field unique `db.indexes` entry on the owning column of a one-to-one names the unique constraint that column already carries instead of being refused, and a relationship's default foreign-key index yields to a single-field entry the same way; a spelled-out `isIndexed` on the field remains a genuine duplicate.

New generate-time refusals, each naming the list, the entry and the fix: `undeclared-extension-pack` (a stored field typed by a pack `db.extensions` does not declare), `field-descriptor-error` (a field whose `getContractField` throws, such as a default the contract cannot carry), `reserved-field-name` (a field named `id`), `foreign-key-column-collision` (a field whose column is the `<field>Id` another relationship on the list owns), `synthetic-relation-collision` (a field named `from_<List>_<field>` where a list-only ref synthesises that back-relation) and `inverse-mismatch` (a bidirectional `ref` whose other end does not ref back). `validateExtensionPacks` and `validateFieldNames` are exported and run as part of `validateDatabaseConfig`; `validateRelations` picks up `inverse-mismatch`.
