# Config System

The config system is the heart of Stack. Define your entire schema, access control, and behavior in one place.

## Basic Config

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, relationship } from '@opensaas/stack-core/fields'

export default config({
  db: { provider: 'postgresql' },
  lists: {
    User: list({
      fields: {
        name: text(),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    }),
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session?.userId,
        },
      },
    }),
  },
})
```

## Config Options

### Database Configuration

Postgres is the only provider. `provider: 'postgresql'` is the one required key on `db`, and everything else on the block is optional:

```typescript
db: {
  provider: 'postgresql',
  idField: 'uuid7',
  timestamps: true,
  schemas: ['public', 'audit'],
  extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
}
```

Notice what is **not** there: no connection string, and no client constructor. The config describes the _shape_ of the database, not how to reach it — the connection is resolved from the environment at runtime, in order: `DIRECT_DATABASE_URL`, then `DATABASE_URL`, then the local Dev database that `opensaas dev` starts. `DIRECT_DATABASE_URL` wins so a schema command reaches a direct connection rather than a pooler that cannot run DDL. A deployment that sets neither variable gets an error naming both, never a silent fallback.

This separation is why the same config file works unchanged across a laptop, CI, and production: the three differ only in which environment variable is set.

The keys above cover the common cases — `idField` picks the primary-key strategy (`'uuid7'` by default), `timestamps` opts every list into `createdAt` / `updatedAt` (off by default), `schemas` declares the Postgres namespaces your lists live in, and `extensions` declares the extension packs the generator emits contract spaces for. Two more exist for narrower needs: `client` (pool options and a `pg` factory for serverless Postgres) and `keystoneCompat` (empty-string text defaults, for a Keystone migration).

See [Config API](/docs/reference/config-api) for the complete key reference.

### Lists Configuration

Lists are your database models:

```typescript
lists: {
  [ListName: string]: list({
    fields: { /* field definitions */ },
    access: { /* access control */ },
    hooks: { /* hooks */ },
    ui: { /* UI options */ },
  })
}
```

List names are **PascalCase**, and that same PascalCase key is what you use at runtime: a list named `Post` is reached as `context.db.Post`. There is no case conversion between the config and the query surface.

## List Options

### Fields

Define your schema using field types:

```typescript
fields: {
  title: text({ validation: { isRequired: true } }),
  content: text(),
  publishedAt: timestamp(),
  author: relationship({ ref: 'User.posts' }),
}
```

See [Field Types](/docs/concepts/field-types) for all available types.

### Access Control

Control who can perform operations. Every slot is a function — there is no bare boolean value:

```typescript
access: {
  operation: {
    query: () => true,
    create: ({ session }) => !!session?.userId,
    update: ({ session, item }) => session?.userId === item?.authorId,
    delete: ({ session, item }) => session?.userId === item?.authorId,
  },
}
```

`query`, `update` and `delete` may return a filter instead of a boolean, which scopes the operation to the records that match it. `create` is the exception: it has no existing row to scope, so it accepts a boolean result only.

See [Access Control](/docs/concepts/access-control) for details.

### Hooks

Transform data and trigger side effects:

```typescript
hooks: {
  resolveInput: async ({ resolvedData }) => {
    if (resolvedData.status === 'published' && !resolvedData.publishedAt) {
      resolvedData.publishedAt = new Date()
    }
    return resolvedData
  },
}
```

See [Hooks](/docs/concepts/hooks) for details.

## Next Steps

- **[Config API](/docs/reference/config-api)** - Every config key in full
- **[Field Types](/docs/concepts/field-types)** - Available field types
- **[Access Control](/docs/concepts/access-control)** - Secure your data
- **[Hooks](/docs/concepts/hooks)** - Data transformation
