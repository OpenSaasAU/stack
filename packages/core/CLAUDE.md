# @opensaas/stack-core

Core stack providing config system, access control engine, hooks, field types, and generators.

## Purpose

The foundation of OpenSaas Stack. Defines the config DSL, executes access control, runs hooks, and generates Prisma schema and TypeScript types from config.

## Key Files & Exports

### Config (`src/config/`)

- `types.ts` - Core type definitions (`OpenSaasConfig`, `ListConfig`, `FieldConfig`, etc.)
- `index.ts` - Builder functions (`config()`, `list()`)
- `schema.ts` - Zod schemas for validation

### Fields (`src/fields/index.ts`)

Field builder functions, each returning object with:

- `getZodSchema(fieldName, operation)` - Validation schema
- `getPrismaType(fieldName)` - Prisma type and modifiers
- `getTypeScriptType()` - TypeScript type and optionality

Built-in fields:

- `text({ validation, ui, hooks })` - String field
- `integer({ validation, ui, hooks })` - Number field
- `checkbox({ defaultValue, ui, hooks })` - Boolean field
- `timestamp({ defaultValue, ui, hooks })` - DateTime field
- `password({ validation, ui, hooks })` - Hashed password (excluded from reads)
- `select({ options, validation, ui, hooks })` - Enum field
- `relationship({ ref, many, ui })` - Foreign key relationship

### Access Control (`src/access/`)

- `engine.ts` - Core execution logic (`applyAccessControl()`)
- `types.ts` - Type definitions (`AccessControl`, `OperationAccessControl`, etc.)

Access control functions receive `{ session, context, item, operation }` and return:

- `boolean` - Allow/deny
- `Prisma filter object` - Scope access to matching records

### Hooks (`src/hooks/`)

- `index.ts` - Hook execution logic
- Types in `config/types.ts`

Hook types:

- `resolveInput` - Transform input data
- `resolveOutput` - Transform output data
- `validateInput` - Custom validation
- `beforeOperation` - Side effects before DB operation
- `afterOperation` - Side effects after DB operation

### Context (`src/context/index.ts`)

- `createContext(config, prisma, session?)` - Creates context wrapper
- Returns `{ db, session }` where `db` is Prisma client with access control

### Generators (`src/generator/`)

- `prisma.ts` - Generates `prisma/schema.prisma` from config
- `types.ts` - Generates `.opensaas/types.ts` TypeScript definitions
- `context.ts` - Generates `.opensaas/context.ts` context factory

Run via CLI: `pnpm generate`

### Utilities (`src/utils.ts`)

- `getDbKey(listKey)` - PascalCase → camelCase (e.g., `BlogPost` → `blogPost`)
- `getUrlKey(listKey)` - PascalCase → kebab-case (e.g., `BlogPost` → `blog-post`)
- `getListKeyFromUrl(urlKey)` - kebab-case → PascalCase (e.g., `blog-post` → `BlogPost`)

## Architecture Patterns

### Field Self-Containment

Fields are fully self-contained. No switch statements in core:

```typescript
// Field defines its own behavior
export function text(options) {
  return {
    type: 'text',
    ...options,
    getPrismaType: () => ({ type: 'String', modifiers: '?' }),
    getTypeScriptType: () => ({ type: 'string', optional: true }),
    getZodSchema: (fieldName, operation) => z.string().optional(),
  }
}

// Generator delegates to field
const prismaType = field.getPrismaType(fieldName)
```

### Access Control Execution Flow

1. User calls `context.db.post.update({ where, data })`
2. Context wrapper intercepts call
3. Check operation-level access → returns boolean or filter
4. Merge filter with user's `where` clause
5. Execute Prisma operation
6. Apply field-level read access (filter readable fields)
7. Return result or `null`/`[]` on access denial

### Hook Execution Order (Write)

1. List `resolveInput`
2. Field `resolveInput` (e.g., hash password)
3. List `validateInput`
4. Field validation (isRequired, length, min/max)
5. Field-level access control (filter writable fields)
6. Field `beforeOperation`
7. List `beforeOperation`
8. **Database operation**
9. List `afterOperation`
10. Field `afterOperation`

### Hook Execution Order (Read)

1. **Database operation**
2. Field-level access control (filter readable fields)
3. Field `resolveOutput`
4. Field `afterOperation`

### Context Type Safety

Context uses generic typing to preserve Prisma types:

```typescript
const context = createContext<typeof prisma>(config, prisma, session)
// context.db.post.findMany() is fully typed
```

## Integration Points

### With @opensaas/stack-ui

- UI reads config to generate admin interface
- Field `ui` options pass through to components
- Component registry pattern for field rendering

### With @opensaas/stack-auth

- Auth merges lists into config
- Session flows through context to access control
- Generator creates auth tables in Prisma schema

### With @opensaas/stack-mcp

- MCP reads config to generate tools
- Uses context for all operations (access control enforced)
- Zod schemas from fields validate tool inputs

### With Third-Party Field Packages

- Packages export field builders implementing `BaseFieldConfig`
- No changes needed to core - fields are self-contained
- Example: `@opensaas/stack-tiptap` provides `richText()` field

## Common Patterns

### Basic Config

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, integer, relationship } from '@opensaas/stack-core/fields'

export default config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        views: integer({ defaultValue: 0 }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session,
          update: ({ session, item }) => session?.userId === item.authorId,
        },
      },
    }),
  },
})
```

### Silent Failures

Access-controlled operations return `null` or `[]` instead of throwing:

```typescript
const post = await context.db.post.update({ where: { id }, data })
if (!post) {
  // Either doesn't exist OR access denied
  return { error: 'Access denied or not found' }
}
```

### Field-Level Hooks

```typescript
password: password({
  hooks: {
    resolveInput: async ({ value }) => {
      if (value) return await bcrypt.hash(value, 10)
      return value
    },
    resolveOutput: ({ value }) => {
      return new HashedPassword(value) // Wrap for security
    },
  },
})
```

### Custom Prisma Client Constructor

```typescript
config({
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL,
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL })
      return new PrismaClient({ adapter })
    },
  },
})
```

### Relationship Patterns

```typescript
// One-to-many
User: list({
  fields: {
    posts: relationship({ ref: 'Post.author', many: true }),
  },
})

// Many-to-one (other side)
Post: list({
  fields: {
    author: relationship({ ref: 'User.posts' }),
  },
})
```

## Type Safety

All types are strongly typed with TypeScript:

- Config is validated via Zod schemas
- Context provides full Prisma type inference
- Access control functions are typed with proper generics
- Avoid `any` and `unknown` in external APIs (internal use only where necessary)
