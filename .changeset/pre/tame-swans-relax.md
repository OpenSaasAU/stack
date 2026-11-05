---
'@opensaas/stack-core': minor
'@opensaas/stack-auth': minor
'@opensaas/stack-storage': minor
'@opensaas/stack-cli': minor
---

Rewrite public API docblocks (and the `opensaas generate` CLI description) that still described the generator's output in Prisma-schema-language terms (`@@map`/`@@schema`/`@@unique`/`@@index`/`multiSchema`/`@default(...)`/`@db.<type>`) — the Prisma 8 pipeline emits a TypeScript contract, not a `.prisma` schema (ADR-0040), and no such attributes are ever produced. Affected options include `ListConfig.db.map`/`db.schema`/`db.indexes`/`db.nativeType`, `SelectField.db.type`/`db.enumName`/`db.isNullable`, `RelationshipField.isIndexed`/`db.isNullable`, `DatabaseConfig.schemas`/`db.timestamps`, `OpenSaasConfig.output`, `Plugin.beforeGenerate`, and the equivalent auth-plugin model config (`AuthModelConfig.tableName`/`fields`/`schema`, `AuthConfig.schema`/`rateLimit`/`betterAuthOptions`). Docs now describe what the contract actually carries: a model's `table`/`namespace`, a column's `map`/type/nullability, a declared `enums` entry, and `unique`/`index` constraints.
