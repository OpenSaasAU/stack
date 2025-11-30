# @opensaas/stack-db

**Custom database layer for OpenSaas Stack (Prototype)**

This is a prototype implementation of a custom ORM designed specifically for OpenSaas Stack's config-first architecture. It aims to eliminate the impedance mismatch between the config system and database operations.

## Status: Prototype

This is a proof-of-concept to validate the approach. **Not production-ready.**

## Key Features

- ✅ **Config-first schema generation** - Generate tables directly from OpenSaas config
- ✅ **Minimal CRUD operations** - findUnique, findMany, create, update, delete, count
- ✅ **Filter system** - Designed for access control merging
- ✅ **SQLite support** - Production-quality SQLite adapter
- ✅ **PostgreSQL support** - Native `pg` and Neon serverless adapters
- ✅ **Relationship loading** - Full `include` support with nested where filters
- ✅ **Type-safe** - Full TypeScript support

## Architecture

```
OpenSaas Config
    ↓
Schema Generator → Table Definitions
    ↓
Database Adapter (SQLite / PostgreSQL)
    ↓
Query Builder (CRUD operations)
    ↓
Access Control Wrapper (from @opensaas/stack-core)
```

## Usage

### SQLite

```typescript
import { SQLiteAdapter } from '@opensaas/stack-db/adapter'
import { QueryBuilder } from '@opensaas/stack-db/query'
import { generateTableDefinitions } from '@opensaas/stack-db/schema'
import config from './opensaas.config'

// Generate schema from config
const tables = generateTableDefinitions(config)

// Create SQLite adapter
const adapter = new SQLiteAdapter({
  provider: 'sqlite',
  url: 'file:./dev.db',
})

await adapter.connect()

// Create tables
for (const table of tables) {
  await adapter.createTable(table)
}

// Use query builder
const postTable = tables.find((t) => t.name === 'Post')!
const posts = new QueryBuilder(adapter, 'Post', postTable)

// CRUD operations
const post = await posts.create({
  data: { title: 'Hello', content: 'World' },
})
```

### PostgreSQL (Native pg)

```typescript
import { PostgreSQLAdapter } from '@opensaas/stack-db/adapter'
import { Pool } from 'pg'

// Create your own pg Pool (full control over configuration)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Configure pool size
  idleTimeoutMillis: 30000,
})

// Pass driver to adapter (dependency injection)
const adapter = new PostgreSQLAdapter({
  provider: 'postgresql',
  driver: pool,
})

await adapter.connect()

// Rest is the same as SQLite
const postTable = tables.find((t) => t.name === 'Post')!
const posts = new QueryBuilder(adapter, 'Post', postTable)

const post = await posts.create({
  data: { title: 'Hello PostgreSQL' },
})
```

### PostgreSQL (Neon Serverless)

```typescript
import { PostgreSQLAdapter } from '@opensaas/stack-db/adapter'
import { Pool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

// Configure Neon for Node.js (WebSocket)
neonConfig.webSocketConstructor = ws

// Create Neon Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Pass driver to adapter (dependency injection)
const adapter = new PostgreSQLAdapter({
  provider: 'postgresql',
  driver: pool, // Works with any driver that implements PostgresDriver interface
})

await adapter.connect()

// Works identically to native pg
const posts = new QueryBuilder(adapter, 'Post', postTable)
```

## Filter Syntax

The filter system is designed to be simple and merge-friendly for access control:

```typescript
// Simple equality
{ status: 'published' }
{ status: { equals: 'published' } }

// Comparisons
{ views: { gt: 100 } }
{ views: { gte: 100 } }
{ views: { lt: 1000 } }
{ views: { lte: 1000 } }

// Lists
{ status: { in: ['published', 'featured'] } }
{ status: { notIn: ['draft', 'archived'] } }

// String operations
{ title: { contains: 'hello' } }
{ title: { startsWith: 'hello' } }
{ title: { endsWith: 'world' } }

// Logical operators
{
  AND: [
    { status: 'published' },
    { views: { gt: 100 } }
  ]
}

{
  OR: [
    { status: 'featured' },
    { views: { gt: 1000 } }
  ]
}

{
  NOT: { status: 'draft' }
}
```

## Filter Merging (Access Control)

The key insight is that filters are just objects, so merging is trivial:

```typescript
import { mergeFilters } from '@opensaas/stack-db'

// User filter
const userFilter = { authorId: session.userId }

// Access control filter
const accessFilter = { status: 'published' }

// Merge with AND
const merged = mergeFilters(userFilter, accessFilter)
// Result: { AND: [{ authorId: '...' }, { status: 'published' }] }

// Use in query
const posts = await posts.findMany({ where: merged })
```

This is **much simpler** than Drizzle's functional approach and **just as elegant** as Prisma's.

## Relationships

The ORM supports full relationship loading with `include`, just like Prisma.

### Defining Relationships

When creating query builders, pass a relationship map:

```typescript
// User → Posts (one-to-many)
const users = new QueryBuilder(adapter, 'User', userTable, {
  posts: {
    name: 'posts',
    type: 'one-to-many',
    targetTable: 'Post',
    foreignKey: 'authorId', // FK on the Post table
  },
})

// Post → User (many-to-one)
const posts = new QueryBuilder(adapter, 'Post', postTable, {
  author: {
    name: 'author',
    type: 'many-to-one',
    targetTable: 'User',
    foreignKey: 'authorId', // FK on this table
  },
})
```

**Or use the helper** to generate from OpenSaas config:

```typescript
import { generateRelationshipMaps } from '@opensaas/stack-db/schema'

const relationshipMaps = generateRelationshipMaps(config)

const users = new QueryBuilder(adapter, 'User', userTable, relationshipMaps['User'])

const posts = new QueryBuilder(adapter, 'Post', postTable, relationshipMaps['Post'])
```

### Loading Relationships

Use `include` in `findUnique` and `findMany`:

```typescript
// Load a post with its author (many-to-one)
const post = await posts.findUnique({
  where: { id: 'post-123' },
  include: { author: true },
})

console.log(post.title) // 'Hello World'
console.log(post.author.name) // 'John Doe'
console.log(post.author.email) // 'john@example.com'

// Load a user with all their posts (one-to-many)
const user = await users.findUnique({
  where: { id: 'user-123' },
  include: { posts: true },
})

console.log(user.name) // 'John Doe'
console.log(user.posts.length) // 5
user.posts.forEach((post) => {
  console.log(post.title) // All posts by this user
})

// Load multiple records with relationships
const allPosts = await posts.findMany({
  where: { status: 'published' },
  include: { author: true },
})

allPosts.forEach((post) => {
  console.log(`${post.title} by ${post.author.name}`)
})
```

### Filtering Related Records

You can filter relationships using `where` inside `include`:

```typescript
// Load user with only published posts
const user = await users.findUnique({
  where: { id: 'user-123' },
  include: {
    posts: {
      where: { status: { equals: 'published' } },
    },
  },
})

console.log(user.posts) // Only published posts

// Load post only if author is admin
const post = await posts.findUnique({
  where: { id: 'post-123' },
  include: {
    author: {
      where: { role: { equals: 'admin' } },
    },
  },
})

// post.author will be null if user is not admin
if (post.author) {
  console.log('Author is admin:', post.author.name)
} else {
  console.log('Author is not admin or does not exist')
}
```

### Relationship Types

**Many-to-one** (e.g., `Post.author`):

- Foreign key lives on the current table (`authorId` on `Post`)
- Returns a single record or `null`
- Loaded with a simple lookup by ID

**One-to-many** (e.g., `User.posts`):

- Foreign key lives on the target table (`authorId` on `Post`)
- Returns an array (empty array if no related records)
- Loaded with a filtered query

**Null handling:**

- Many-to-one returns `null` if FK is null or record doesn't exist
- One-to-many returns empty array `[]` if no related records
- Where filters in include can also result in `null` or filtered arrays

## Testing

```bash
# Run tests
pnpm test

# Run tests with UI
pnpm test:ui

# Run tests with coverage
pnpm test:coverage
```

## Comparison to Prisma

### What's Simpler

- ✅ No separate schema file (schema.prisma)
- ✅ No generation step (Prisma client generation)
- ✅ Direct config → database
- ✅ No engines/binaries
- ✅ Smaller bundle (~50KB vs ~3MB)

### What's the Same

- ✅ Filter syntax (very similar to Prisma)
- ✅ CRUD operations (same API)
- ✅ Type safety (same level)

### What's Missing (for now)

- ❌ Many-to-many relationships (requires join tables)
- ❌ Nested includes (e.g., `include: { author: { include: { profile: true } } }`)
- ❌ Migration files (only push/pull for now)
- ❌ Advanced features (aggregations, transactions, etc.)
- ❌ Prisma Studio equivalent
- ❌ Extensive battle testing
- ❌ Performance optimization (batch loading, query optimization)

## Prototype Goals

1. ✅ Validate that filter syntax works well for access control
2. ✅ Confirm that schema generation is simpler
3. ✅ Verify that query builder can handle basic operations
4. ✅ Test performance vs Prisma
5. ⏳ Integrate with existing access control system
6. ⏳ Test with real example app (blog)

## Next Steps

If prototype is successful:

1. Add PostgreSQL adapter
2. Add migration file support
3. Optimize query performance
4. Add more advanced features as needed
5. Production hardening
6. Documentation
7. Gradual rollout (v2.0-beta)

## License

MIT
