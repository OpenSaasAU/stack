# Config System

The config system is the heart of OpenSaaS Stack. Define your entire schema, access control, and behavior in one place.

## Basic Config

```typescript
import { config, list } from '@opensaas/stack-core/config'
import { text, relationship } from '@opensaas/stack-core/fields'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

export default config({
  db: {
    provider: 'sqlite',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || './dev.db' })
      return new PrismaClient({ adapter })
    },
  },
  lists: {
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

Prisma 7 requires database adapters. The `prismaClientConstructor` function creates a Prisma client with the appropriate adapter for your database.

```typescript
db: {
  provider: 'sqlite' | 'postgresql' | 'mysql',
  prismaClientConstructor: (PrismaClient: any) => PrismaClient,
}
```

**SQLite Example:**

```typescript
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

db: {
  provider: 'sqlite',
  prismaClientConstructor: (PrismaClient) => {
    const adapter = new PrismaBetterSqlite3({ url: './dev.db' })
    return new PrismaClient({ adapter })
  },
}
```

**PostgreSQL (Neon) Example:**

```typescript
import { PrismaNeon } from '@prisma/adapter-neon'

db: {
  provider: 'postgresql',
  prismaClientConstructor: (PrismaClient) => {
    const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL })
    return new PrismaClient({ adapter })
  },
}
```

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

See [Field Types](/docs/core-concepts/field-types) for all available types.

### Access Control

Control who can perform operations:

```typescript
access: {
  operation: {
    query: true,
    create: ({ session }) => !!session?.userId,
    update: ({ session, item }) => session?.userId === item.authorId,
    delete: ({ session, item }) => session?.userId === item.authorId,
  },
}
```

See [Access Control](/docs/core-concepts/access-control) for details.

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

See [Hooks](/docs/core-concepts/hooks) for details.

## Next Steps

- **[Field Types](/docs/core-concepts/field-types)** - Available field types
- **[Access Control](/docs/core-concepts/access-control)** - Secure your data
- **[Hooks](/docs/core-concepts/hooks)** - Data transformation
