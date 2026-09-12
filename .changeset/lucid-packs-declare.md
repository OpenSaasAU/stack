---
'@opensaas/stack-core': minor
'@opensaas/stack-auth': patch
'@opensaas/stack-cli': patch
---

The Prisma 8 config surface: `db.idField`, `db.extensions`, `db.client`, `db.provider` (postgresql only), typed `onDelete`/`onUpdate` on relationships, `db.indexes` without `sort`, and `PluginContext.addExtension` (ADR-0040, ADR-0048, ADR-0049, ADR-0064).

```typescript
export default config({
  db: {
    provider: 'postgresql',
    idField: 'uuid7', // the default; 'cuid2' | 'int autoincrement'
    extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
    client: {
      pg: () => new Pool({ connectionString: process.env.DATABASE_URL }), // a lazy factory
    },
  },
  lists: {
    Invoice: list({
      fields: {
        customer: relationship({ ref: 'Customer.invoices', db: { onDelete: 'restrict' } }),
      },
      db: {
        idField: 'int autoincrement',
        indexes: [{ fields: ['customer'], name: 'Invoice_customer_idx' }],
      },
    }),
  },
})

// A plugin declares the pack its field types need; the same name from the same
// package merges, the same name from a different package throws.
init: async (context) => {
  context.addExtension({ name: 'pgvector', from: '@prisma/orm-extension-pgvector' })
}
```

`pnpm generate` now refuses, naming the list, the entry and the fix (`validateDatabaseConfig` and `validateRelations` are exported for the same checks elsewhere): a `sort` direction on a `db.indexes` field reference; `many: true` on both sides of a relationship or on a list-only ref (author the junction as its own list); `db.idField` on a singleton; `db.foreignKey: true` on both sides of a one-to-one; `db.isNullable: false`, `db.onDelete`/`db.onUpdate` or a `db.indexes` entry on a side that owns no foreign key column; `'setNull'` together with `db.isNullable: false`; a `many: false` relationship whose `ref` is its own field; the same extension pack name declared from two packages; and a relationship at a composite-keyed list.

`prismaClientConstructor`, `extendPrismaSchema` (config- and field-level), `joinTableNaming` and `db.relationName` are removed from the config types. `@opensaas/stack-auth`'s derived lists declare their cascade through `db.onDelete` instead of `extendPrismaSchema`.
