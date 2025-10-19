# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenSaaS Framework is a Next.js-based framework for building admin-heavy applications with built-in access control. It uses a config-first approach similar to KeystoneJS but modernized for Next.js App Router and designed to be AI-agent-friendly with automatic security guardrails.

This is a pnpm monorepo with:
- `packages/core`: Core framework (config system, access control)
- `packages/cli`: CLI tools (planned, generators)
- `packages/ui`: Admin UI components (UI components)
- `examples/blog`: Working example demonstrating the framework

## Common Commands

### Development
```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build

# Build in development mode (watch)
pnpm dev

# Clean build artifacts
pnpm clean
```

### Working with Core Package
```bash
cd packages/core

# Build the core package
pnpm build

# Run tests
pnpm test

# Run tests with UI
pnpm test:ui

# Run tests with coverage
pnpm test:coverage
```

### Working with Examples
```bash
cd examples/blog

# Generate Prisma schema and types from opensaas.config.ts
pnpm generate

# Push schema to database (creates/updates SQLite file)
pnpm db:push

# Generate Prisma Client
npx prisma generate

# Open Prisma Studio
pnpm db:studio

# Run development server
pnpm dev

# Build for production
pnpm build
```

### Testing Example Changes
```bash
# Run test scripts directly
cd examples/blog
npx tsx test.ts  # or any other .ts file
```

## Architecture

### Access Control System (Core Feature)

The framework's primary innovation is its access control engine that automatically secures database operations. Understanding this is critical for working with the codebase.

**Key files:**
- `packages/core/src/context/index.ts` - Context wrapper that intercepts all Prisma operations
- `packages/core/src/access/engine.ts` - Access control execution logic
- `packages/core/src/access/types.ts` - Type definitions for access control

**How it works:**
1. User defines access control in `opensaas.config.ts` using `AccessControl` functions
2. Operations go through context wrapper: `context.db.post.update()` instead of `prisma.post.update()`
3. Access control engine checks operation-level access (can user perform this action?)
4. Access filters are merged with Prisma where clauses (which records can they access?)
5. Field-level access controls which fields are readable/writable
6. Operations return `null` or `[]` on access denial (silent failures prevent info leakage)

**Access Control Types:**
- **Operation-level**: Controls query/create/update/delete access at the list level
- **Field-level**: Controls read/create/update access for individual fields
- **Filter-based**: Returns Prisma filters to scope access (e.g., `{ authorId: { equals: userId } }`)
- **Boolean**: Returns `true` (allow) or `false` (deny)

### Hooks System (Phase 3)

The hooks system allows data transformation and validation during database operations.

**Key file:** `packages/core/src/hooks/index.ts`

**Hook execution order (create/update):**
1. `resolveInput` - Transform input data (e.g., auto-populate fields)
2. `validateInput` - Custom validation logic
3. Field validation - Built-in rules (isRequired, length, min/max)
4. Field-level access control - Filter writable fields
5. `beforeOperation` - Side effects before DB operation
6. **Database operation**
7. `afterOperation` - Side effects after DB operation

**Example use cases:**
- `resolveInput`: Auto-set publishedAt when status changes to "published"
- `validateInput`: Business logic validation (e.g., "title cannot contain spam")
- `beforeOperation`: Logging, notifications
- `afterOperation`: Cache invalidation, webhooks

### Config System

**Key files:**
- `packages/core/src/config/types.ts` - Type definitions
- `packages/core/src/config/index.ts` - Config builder functions

Users define their schema in `opensaas.config.ts`:
```typescript
export default config({
  db: { provider: 'sqlite', url: 'file:./dev.db' },
  lists: {
    Post: list({
      fields: { title: text({ validation: { isRequired: true } }) },
      access: { operation: { query: () => true, update: isAuthor } },
      hooks: { resolveInput: async ({ resolvedData }) => resolvedData }
    })
  }
})
```

### Generators

**Key files:**
- `packages/core/src/generator/prisma.ts` - Generates `prisma/schema.prisma`
- `packages/core/src/generator/types.ts` - Generates `.opensaas/types.ts`
- `packages/core/bin/generate.cjs` - CLI entry point

Run with `pnpm generate` to convert `opensaas.config.ts` into Prisma schema and TypeScript types.

**Architecture:** Generators delegate to field builder methods rather than using switch statements. Each field type provides its own generation logic through `getPrismaType()` and `getTypeScriptType()` methods.

### Field Types

**Key file:** `packages/core/src/fields/index.ts`

Available field types:
- `text()` - String field with validation (isRequired, length)
- `integer()` - Number field with validation (isRequired, min, max)
- `checkbox()` - Boolean field
- `timestamp()` - Date/time field with auto-now support
- `password()` - String field (excluded from reads)
- `select()` - Enum field with predefined options
- `relationship()` - Foreign key relationship (one-to-one, one-to-many)

**Field Builder Methods:**

Each field builder function returns an object with these methods:

1. **`getZodSchema(fieldName, operation)`** - Validation schema generation
2. **`getPrismaType(fieldName)`** - Prisma type and modifiers (e.g., `{ type: "String", modifiers: "?" }`)
3. **`getTypeScriptType()`** - TypeScript type and optionality (e.g., `{ type: "string", optional: true }`)

This allows field types to be fully self-contained and extensible without modifying core framework code.

## Critical Patterns

### 1. Naming Conventions

The framework uses consistent case conventions across different contexts:

**List Names in Config:** Always use **PascalCase**
```typescript
lists: {
  User: list({ ... }),        // Good
  BlogPost: list({ ... }),    // Good
  AuthUser: list({ ... }),    // Good

  user: list({ ... }),        // Bad - don't use lowercase
  blog_post: list({ ... }),   // Bad - don't use snake_case
}
```

**Case Conversions:**
- **Prisma Models:** PascalCase (e.g., `AuthUser`, `BlogPost`)
- **Prisma Client Properties:** camelCase (e.g., `prisma.authUser`, `prisma.blogPost`)
- **Context DB Properties:** camelCase (e.g., `context.db.authUser`, `context.db.blogPost`)
- **Admin UI URLs:** kebab-case (e.g., `/admin/auth-user`, `/admin/blog-post`)

**Utility Functions:**
```typescript
import { getDbKey, getUrlKey, getListKeyFromUrl } from '@opensaas/core'

getDbKey('AuthUser')           // 'authUser' - for accessing context.db and prisma
getUrlKey('AuthUser')          // 'auth-user' - for constructing URLs
getListKeyFromUrl('auth-user') // 'AuthUser' - for parsing URLs
```

### 2. Creating Context in Applications

Applications must create a context wrapper for Prisma:

```typescript
// lib/context.ts
import { getContext } from '@opensaas/core'
import { PrismaClient } from '@prisma/client'
import config from '../opensaas.config'

export const prisma = new PrismaClient()

export async function getContextWithUser(userId: string) {
  return getContext(config, prisma, { userId })
}
```

### 3. Silent Failures

Access-controlled operations return `null` (single record) or `[]` (multiple records) when access is denied, rather than throwing errors. This prevents information leakage about whether records exist.

**Always check for null:**
```typescript
const post = await context.db.post.update({ where: { id }, data })
if (!post) {
  // Either doesn't exist OR user doesn't have access
  return { error: 'Access denied' }
}
```

### 4. System Fields

Fields `id`, `createdAt`, `updatedAt` are automatically:
- Added to Prisma schema
- Excluded from access control (always readable)
- Excluded from field-level write operations

### 4. Relationship Patterns

Relationships use a `ref` format: `'ListName.fieldName'`
- One-to-many: `posts: relationship({ ref: 'Post.author', many: true })`
- Many-to-one: `author: relationship({ ref: 'User.posts' })`
- Prisma generates foreign keys automatically

## Development Workflow

### Making Changes to Core

1. Edit TypeScript files in `packages/core/src/`
2. Build with `pnpm build` (or `pnpm dev` for watch mode)
3. Test changes in examples:
   ```bash
   cd examples/blog
   pnpm generate  # Regenerate if config types changed
   npx tsx test.ts  # Run test script
   ```

### Adding New Field Types

**IMPORTANT:** Field types are fully self-contained. Do NOT add switch statements to core or UI packages.

1. **Define the field type** in `packages/core/src/config/types.ts`:
   ```typescript
   export type MyCustomField = BaseFieldConfig & {
     type: "myCustom";
     customOption?: string;
   };
   ```

2. **Create the field builder** in `packages/core/src/fields/index.ts`:
   ```typescript
   export function myCustom(options?: Omit<MyCustomField, "type">): MyCustomField {
     return {
       type: "myCustom",
       ...options,
       getZodSchema: (fieldName, operation) => {
         // Return Zod schema for validation
         return z.string().optional();
       },
       getPrismaType: (fieldName) => {
         // Return Prisma type and modifiers
         return { type: "String", modifiers: "?" };
       },
       getTypeScriptType: () => {
         // Return TypeScript type and optionality
         return { type: "string", optional: true };
       },
     };
   }
   ```

3. **Register UI component** (optional, for admin UI):
   ```typescript
   import { registerFieldComponent } from "@opensaas/ui";
   import { MyCustomFieldComponent } from "./components/MyCustomField";

   registerFieldComponent("myCustom", MyCustomFieldComponent);
   ```

**Key Principle:** The field config object drives ALL behavior. Generators, validators, and UI components delegate to field methods. Never add switch statements based on field type in core or UI packages.

### Customizing UI Components

The UI layer uses a component registry pattern to avoid switch statements and enable extensibility.

**Two approaches for custom field components:**

1. **Global Registration** - Register a component for reuse across multiple fields:
   ```typescript
   import { registerFieldComponent } from "@opensaas/ui";
   import { ColorPickerField } from "./components/ColorPickerField";

   // Register once at app startup
   registerFieldComponent("color", ColorPickerField);

   // Use in multiple fields by referencing the fieldType
   fields: {
     favoriteColor: text({ ui: { fieldType: "color" } }),
     themeColor: text({ ui: { fieldType: "color" } }),
   }
   ```

2. **Per-Field Override** - Pass a component directly for one-off customization:
   ```typescript
   import { SlugField } from "./components/SlugField";

   fields: {
     slug: text({
       ui: { component: SlugField }  // Used only for this field
     })
   }
   ```

**Component Resolution Priority:**
1. `ui.component` (per-field override) - highest priority
2. `ui.fieldType` (global registry lookup by custom type name)
3. `fieldConfig.type` (default registry lookup by field type)

**See:** `examples/custom-field` for a complete working example demonstrating both patterns.

### Testing Access Control Changes

The blog example's test script (README test code) exercises all access control paths:
- Anonymous vs. authenticated users
- Published vs. draft posts
- Author vs. non-author access
- Field-level access (internalNotes)

## Important Considerations

### TypeScript Module System

This project uses ESM (`"type": "module"` in package.json):
- All imports must include `.js` extensions (not `.ts`)
- Use `import type` for type-only imports
- Config: `moduleResolution: "bundler"`, `module: "ESNext"`

### Access Control Session Object

The `session` object passed to access control functions is user-defined. The framework only requires it exists but doesn't enforce a structure. Common pattern:
```typescript
{ userId: string }  // or null for anonymous
```

### Prisma Client Type Safety

The context uses generic typing to preserve Prisma Client types:
```typescript
const context = await getContext<typeof prisma>(config, prisma, session)
// context.db operations are fully typed
```

### Generator Limitations

Current generators are basic:
- No migration support (use `prisma db push`)
- No introspection support
- Limited Prisma features (no raw queries, transactions, etc.)

## Testing

Tests use Vitest. Run from core package:
```bash
cd packages/core
pnpm test
```
