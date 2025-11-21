# @opensaas/stack-cli

Command-line tools for OpenSaas Stack providing code generation and development utilities.

## Purpose

Converts `opensaas.config.ts` into Prisma schema and TypeScript types. Provides watch mode for automatic regeneration during development.

## Key Files & Commands

### Binary (`bin/opensaas.js`)

Entry point exposing `opensaas` CLI command

### Commands (`src/commands/`)

- `generate.ts` - One-time generation
- `dev.ts` - Watch mode with automatic regeneration
- `init.ts` - Project scaffolding (future)

### Generators (`src/generator/`)

- `prisma.ts` - Generates `prisma/schema.prisma` from config
- `types.ts` - Generates `.opensaas/types.ts` TypeScript types
- `context.ts` - Generates `.opensaas/context.ts` context factory
- `mcp.ts` - Generates MCP tools metadata
- `type-patcher.ts` - Patches Prisma types for relationships

## Architecture

### Config Loading

Uses `jiti` to execute TypeScript config:

```typescript
const jiti = createJiti(import.meta.url)
const config = jiti('./opensaas.config.ts').default
```

### Generator Pipeline

1. Load config from `opensaas.config.ts`
2. Generate Prisma schema → `prisma/schema.prisma`
3. Generate TypeScript types → `.opensaas/types.ts`
4. Generate context factory → `.opensaas/context.ts`
5. Generate MCP tools (if enabled) → `.opensaas/mcp-tools.json`

### Watch Mode

Uses `chokidar` to watch `opensaas.config.ts`:

```typescript
const watcher = chokidar.watch('opensaas.config.ts')
watcher.on('change', () => runGenerator())
```

## CLI Usage

### Generate Command

```bash
opensaas generate
```

Outputs:

- `✅ Prisma schema generated`
- `✅ TypeScript types generated`
- Next steps (run `prisma generate` and `db push`)

### Dev Command

```bash
opensaas dev
```

Outputs:

- Initial generation
- `👀 Watching opensaas.config.ts for changes...`
- Auto-regenerates on file changes

## Generated Files

### Prisma Schema (`prisma/schema.prisma`)

```prisma
datasource db {
  provider = "sqlite"
}

generator client {
  provider = "prisma-client"
}

model Post {
  id String @id @default(cuid())
  title String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Note:** Prisma 7 no longer includes `url` in the schema. The database URL is passed to PrismaClient via adapters in the `prismaClientConstructor` function.

### Types (`.opensaas/types.ts`)

```typescript
export type Post = {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
}

export type PostCreateInput = {
  title: string
}

export type PostUpdateInput = {
  title?: string
}
```

### Context Factory (`.opensaas/context.ts`)

```typescript
import { createContext } from '@opensaas/stack-core'
import { PrismaClient } from '@prisma/client'
import config from '../opensaas.config'

// Prisma 7 requires adapters - PrismaClient created via prismaClientConstructor
const prisma = config.db.prismaClientConstructor(PrismaClient)

export function getContext(session?: any) {
  return createContext(config, prisma, session)
}
```

**Note:** The actual generated context is more sophisticated with async config resolution and singleton management, but this shows the core pattern.

## Integration Points

### With @opensaas/stack-core

- Imports generator functions from core
- Delegates Prisma/TS generation to field methods via core

### With @opensaas/stack-auth

- Context factory supports custom `prismaClientConstructor` for Better-auth session provider

### With MCP (Model Context Protocol)

- Generates MCP tools metadata when MCP enabled in config
- MCP functionality is now in `@opensaas/stack-core/mcp` (runtime) and `@opensaas/stack-auth/mcp` (adapter)

### With Prisma

Workflow:

1. `opensaas generate` → creates `prisma/schema.prisma`
2. `npx prisma generate` → creates Prisma Client
3. `npx prisma db push` → pushes schema to database

## Common Patterns

### Development Workflow

```bash
# Terminal 1: Watch and regenerate
opensaas dev

# Terminal 2: Run Next.js
pnpm next dev

# Edit opensaas.config.ts - auto regenerates!
```

### Package.json Scripts

```json
{
  "scripts": {
    "generate": "opensaas generate",
    "db:push": "prisma db push",
    "db:studio": "prisma studio",
    "dev": "opensaas dev"
  }
}
```

### CI/CD Integration

```yaml
- run: pnpm install
- run: opensaas generate
- run: npx prisma generate
- run: pnpm test
```

### Custom Prisma Client (Required in Prisma 7)

**All configs must provide `prismaClientConstructor`** with a database adapter:

```typescript
// SQLite example
import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'

config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
    prismaClientConstructor: (PrismaClient) => {
      const db = new Database(process.env.DATABASE_URL || './dev.db')
      const adapter = new PrismaBetterSQLite3(db)
      return new PrismaClient({ adapter })
    },
  },
})
```

```typescript
// PostgreSQL example
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

config({
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL,
    prismaClientConstructor: (PrismaClient) => {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      const adapter = new PrismaPg(pool)
      return new PrismaClient({ adapter })
    },
  },
})
```

Generated context always uses the constructor:

```typescript
// .opensaas/context.ts
const prisma = config.db.prismaClientConstructor(PrismaClient)
```

## Type Patching

CLI patches Prisma types for relationship fields to handle access control:

- Relationships can be `null` when access denied
- Adds `| null` to relationship field types in generated types

## Error Handling

Common errors:

- Config not found → check file exists in CWD
- TypeScript errors in config → fix syntax in `opensaas.config.ts`
- Permission denied → ensure write access to `prisma/` and `.opensaas/`

## Output Styling

Uses `chalk` and `ora` for colored, animated output:

- ✅ Green checkmarks for success
- ❌ Red X for errors
- 🚀 Emoji for branding
- Spinner animations during generation

## Future Commands

`opensaas init` - Project scaffolding with templates (planned)
