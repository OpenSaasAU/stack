---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-rag': patch
---

Upgrade to Prisma 7 with database adapter support

## Breaking Changes

### Required `prismaClientConstructor`

Prisma 7 requires database adapters. All configs must now include `prismaClientConstructor`:

```typescript
import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'

export default config({
  db: {
    provider: 'sqlite',
    prismaClientConstructor: (PrismaClient) => {
      const db = new Database(process.env.DATABASE_URL || './dev.db')
      const adapter = new PrismaBetterSQLite3(db)
      return new PrismaClient({ adapter })
    },
  },
})
```

### Removed `url` from `DatabaseConfig`

The `url` field has been removed from the `DatabaseConfig` type. Database connection URLs are now passed directly to adapters in `prismaClientConstructor`:

```typescript
// ❌ Before (Prisma 6)
db: {
  provider: 'sqlite',
  url: 'file:./dev.db',  // url in config
}

// ✅ After (Prisma 7)
db: {
  provider: 'sqlite',
  prismaClientConstructor: (PrismaClient) => {
    const adapter = new PrismaBetterSQLite3({ url: './dev.db' })  // url in adapter
    return new PrismaClient({ adapter })
  },
}
```

### Generated Schema Changes

- Generator provider changed from `prisma-client-js` to `prisma-client`
- Removed `url` field from datasource block
- Database URL now passed via adapter in `prismaClientConstructor`

### Required Dependencies

Install the appropriate adapter for your database:

- **SQLite**: `@prisma/adapter-better-sqlite3` + `better-sqlite3`
- **PostgreSQL**: `@prisma/adapter-pg` + `pg`
- **MySQL**: `@prisma/adapter-mysql` + `mysql2`

## Migration Steps

1. Install Prisma 7 and adapter:

   ```bash
   pnpm add @prisma/client@7 @prisma/adapter-better-sqlite3 better-sqlite3
   pnpm add -D prisma@7
   ```

2. Update your `opensaas.config.ts` to include `prismaClientConstructor` (see example above)

3. Regenerate schema and client:

   ```bash
   pnpm generate
   npx prisma generate
   ```

4. Push schema to database:
   ```bash
   pnpm db:push
   ```

See the updated documentation in CLAUDE.md for more examples including PostgreSQL and custom adapters.
