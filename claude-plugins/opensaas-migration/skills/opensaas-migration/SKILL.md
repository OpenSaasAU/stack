---
name: opensaas-migration
description: Expert knowledge for migrating projects to OpenSaaS Stack. Use when discussing migration strategies, access control patterns, or OpenSaaS Stack configuration best practices.
---

# OpenSaaS Stack Migration

Expert guidance for migrating existing projects to OpenSaaS Stack.

## When to Use This Skill

Use this skill when:

- Planning a migration from Prisma, KeystoneJS, or Next.js
- Designing access control patterns
- Configuring `opensaas.config.ts`
- Troubleshooting migration issues
- Explaining OpenSaaS Stack concepts

## Migration Process

### 1. Install Required Packages

**IMPORTANT: Always install packages before starting migration**

Detect the user's package manager (check for `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or `bun.lockb`) and use their preferred package manager.

**Required packages:**

```bash
# Using npm
npm install --save-dev @opensaas/stack-cli
npm install @opensaas/stack-core

# Using pnpm
pnpm add -D @opensaas/stack-cli
pnpm add @opensaas/stack-core

# Using yarn
yarn add -D @opensaas/stack-cli
yarn add @opensaas/stack-core

# Using bun
bun add -D @opensaas/stack-cli
bun add @opensaas/stack-core
```

**Optional packages (based on user needs):**

- `@opensaas/stack-auth` - If the project needs authentication
- `@opensaas/stack-ui` - If the project needs the admin UI
- `@opensaas/stack-tiptap` - If the project needs rich text editing
- `@opensaas/stack-storage` - If the project needs file storage
- `@opensaas/stack-rag` - If the project needs semantic search/RAG

**Database adapters (required for Prisma 7):**

SQLite:
```bash
npm install better-sqlite3 @prisma/adapter-better-sqlite3
```

PostgreSQL:
```bash
npm install pg @prisma/adapter-pg
```

Neon (serverless PostgreSQL):
```bash
npm install @neondatabase/serverless @prisma/adapter-neon ws
```

### 2. Schema Analysis

**Prisma Projects:**

- Analyze existing `schema.prisma`
- Identify models, fields, and relationships
- Note any Prisma-specific features used

**KeystoneJS Projects:**

- Review list definitions
- Map KeystoneJS fields to OpenSaaS fields
- Identify access control patterns

### 3. Access Control Design

**Common Patterns:**

```typescript
// Public read, authenticated write
operation: {
  query: () => true,
  create: ({ session }) => !!session?.userId,
  update: ({ session }) => !!session?.userId,
  delete: ({ session }) => !!session?.userId,
}

// Author-only access
operation: {
  query: () => true,
  update: ({ session, item }) => item.authorId === session?.userId,
  delete: ({ session, item }) => item.authorId === session?.userId,
}

// Admin-only
operation: {
  query: ({ session }) => session?.role === 'admin',
  create: ({ session }) => session?.role === 'admin',
  update: ({ session }) => session?.role === 'admin',
  delete: ({ session }) => session?.role === 'admin',
}

// Filter-based access
operation: {
  query: ({ session }) => ({
    where: { authorId: { equals: session?.userId } }
  }),
}
```

### 4. Field Mapping

**Prisma to OpenSaaS:**

| Prisma Type | OpenSaaS Field                 |
| ----------- | ------------------------------ |
| `String`    | `text()`                       |
| `Int`       | `integer()`                    |
| `Boolean`   | `checkbox()`                   |
| `DateTime`  | `timestamp()`                  |
| `Enum`      | `select({ options: [...] })`   |
| `Relation`  | `relationship({ ref: '...' })` |

**KeystoneJS to OpenSaaS:**

| KeystoneJS Field | OpenSaaS Field   |
| ---------------- | ---------------- |
| `text`           | `text()`         |
| `integer`        | `integer()`      |
| `checkbox`       | `checkbox()`     |
| `timestamp`      | `timestamp()`    |
| `select`         | `select()`       |
| `relationship`   | `relationship()` |
| `password`       | `password()`     |

### 5. Database Configuration

**SQLite (Development):**

```typescript
import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'

export default config({
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

**PostgreSQL (Production):**

```typescript
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

export default config({
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

## Common Migration Challenges

### Challenge: Preserving Existing Data

**Solution:**

- Use `opensaas generate` to create Prisma schema
- Use `prisma db push` instead of migrations for existing databases
- Never use `prisma migrate dev` with existing data

### Challenge: Complex Access Control

**Solution:**

- Start with simple boolean access control
- Iterate to filter-based access as needed
- Use field-level access for sensitive data

### Challenge: Custom Field Types

**Solution:**

- Create custom field builders extending `BaseFieldConfig`
- Implement `getZodSchema`, `getPrismaType`, `getTypeScriptType`
- Register UI components for admin interface

## Migration Checklist

- [ ] **Detect package manager** (npm, pnpm, yarn, or bun)
- [ ] **Install required packages** (@opensaas/stack-cli, @opensaas/stack-core)
- [ ] **Install optional packages** (auth, ui, etc. based on needs)
- [ ] **Install database adapter** (better-sqlite3, pg, etc.)
- [ ] Analyze existing schema
- [ ] Design access control patterns
- [ ] Create `opensaas.config.ts`
- [ ] Configure database adapter in config
- [ ] Run `opensaas generate` (or `npx opensaas generate`)
- [ ] Run `prisma generate` (or `npx prisma generate`)
- [ ] Run `prisma db push` (or `npx prisma db push`)
- [ ] Test access control
- [ ] Verify admin UI (if using @opensaas/stack-ui)
- [ ] Update application code to use context
- [ ] Test all CRUD operations
- [ ] Deploy to production

## Best Practices

1. **Start Simple**: Begin with basic access control, refine later
2. **Test Access Control**: Verify permissions work as expected
3. **Use Context Everywhere**: Replace direct Prisma calls with `context.db`
4. **Leverage Plugins**: Use `@opensaas/stack-auth` for authentication
5. **Version Control**: Commit `opensaas.config.ts` to git
6. **Document Decisions**: Comment complex access control logic

## Reporting Issues

**When you encounter bugs or missing features in OpenSaaS Stack:**

If during migration you discover:

- Bugs in OpenSaaS Stack packages
- Missing features that would improve the migration experience
- Documentation gaps or errors
- API inconsistencies or unexpected behavior

**Use the `github-issue-creator` agent** to create a GitHub issue on the `OpenSaasAU/stack` repository:

```
Invoke the github-issue-creator agent with:
- Clear description of the bug or missing feature
- Steps to reproduce (if applicable)
- Expected vs actual behavior
- Affected files and line numbers
- Your suggested solution (if you have one)
```

This ensures bugs and feature requests are properly tracked and addressed by the OpenSaaS Stack team, improving the experience for future users.

**Example:**

If you notice that the migration command doesn't properly handle Prisma enums, invoke the github-issue-creator agent:

> "Found a bug: The migration generator doesn't convert Prisma enums to OpenSaaS select fields. Enums are being ignored during schema analysis in packages/cli/src/migration/introspectors/prisma-introspector.ts"

The agent will create a detailed GitHub issue with reproduction steps and proposed solution.

## Resources

- [OpenSaaS Stack Documentation](https://stack.opensaas.au/)
- [Migration Guide](https://stack.opensaas.au/guides/migration)
- [Access Control Guide](https://stack.opensaas.au/core-concepts/access-control)
- [Field Types](https://stack.opensaas.au/core-concepts/field-types)
