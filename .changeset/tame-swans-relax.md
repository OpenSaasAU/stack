---
'@opensaas/stack-core': minor
'@opensaas/stack-auth': minor
'@opensaas/stack-storage': minor
---

Rewrite public API docblocks that still described the generator's output in Prisma-schema-language terms (`@@map`/`@@schema`/`@@unique`/`@@index`/`multiSchema`) — the Prisma 8 pipeline emits a TypeScript contract, not a `.prisma` schema (ADR-0040), and no such attributes are ever produced. Affected options include `ListConfig.db.map`/`db.schema`/`db.indexes`, `DatabaseConfig.schemas`, `OpenSaasConfig.output`, `RelationshipField.isIndexed`, and the equivalent auth-plugin model config (`AuthModelConfig.tableName`/`fields`/`schema`, `AuthConfig.schema`). Docs now describe what the contract actually carries: a model's `table`/`namespace`, a column's `map`, and `unique`/`index` constraints.
