# @opensaas/stack-rag

## 0.18.2

## 0.18.1

## 0.18.0

## 0.17.0

## 0.16.0

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.1

## 0.12.0

## 0.11.0

## 0.10.0

## 0.9.0

## 0.8.0

## 0.7.0

## 0.6.2

## 0.6.1

## 0.6.0

## 0.5.0

## 0.4.0

### Patch Changes

- [#172](https://github.com/OpenSaasAU/stack/pull/172) [`929a2a9`](https://github.com/OpenSaasAU/stack/commit/929a2a9a2dfa80b1d973d259dd87828d644ea58d) Thanks [@list<Lists.User.TypeInfo>({](https://github.com/list<Lists.User.TypeInfo>({), [@list<Lists.User.TypeInfo>({](https://github.com/list<Lists.User.TypeInfo>({)! - Improve TypeScript type inference for field configs and list-level hooks by automatically passing TypeInfo from list level down

  This change eliminates the need to manually specify type parameters on field builders when using features like virtual fields, and fixes a critical bug where list-level hooks weren't receiving properly typed parameters.

  ## Field Type Inference Improvements

  Previously, users had to write `virtual<Lists.User.TypeInfo>({...})` to get proper type inference. Now TypeScript automatically infers the correct types from the list-level type parameter.

  **Example:**

  ```typescript
  // Before

    fields: {
      displayName: virtual<Lists.User.TypeInfo>({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.name} (${item.email})`,
        },
      }),
    },
  })

  // After

    fields: {
      displayName: virtual({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.name} (${item.email})`,
        },
      }),
    },
  })
  ```

  ## List-Level Hooks Type Inference Fix

  Fixed a critical type parameter mismatch where `Hooks<TTypeInfo>` was passing the entire TypeInfo object as the first parameter instead of properly destructuring it into three required parameters:
  1. `TOutput` - The item type (what's stored in DB)
  2. `TCreateInput` - Prisma create input type
  3. `TUpdateInput` - Prisma update input type

  **Impact:**
  - `resolveInput` now receives proper Prisma input types (e.g., `PostCreateInput`, `PostUpdateInput`)
  - `validateInput` has access to properly typed input data
  - `beforeOperation` and `afterOperation` have correct item types
  - All list-level hook callbacks now get full IntelliSense and type checking

  **Example:**

  ```typescript
  Post: list<Lists.Post.TypeInfo>({
    fields: { title: text(), content: text() },
    hooks: {
      resolveInput: async ({ operation, resolvedData }) => {
        // ✅ resolvedData is now properly typed as PostCreateInput or PostUpdateInput
        // ✅ Full autocomplete for title, content, etc.
        if (operation === 'create') {
          console.log(resolvedData.title) // TypeScript knows this is string | undefined
        }
        return resolvedData
      },
      beforeOperation: async ({ operation, item }) => {
        // ✅ item is now properly typed as Post with all fields
        if (operation === 'update' && item) {
          console.log(item.title) // TypeScript knows this is string
          console.log(item.createdAt) // TypeScript knows this is Date
        }
      },
    },
  })
  ```

  ## Breaking Changes
  - Field types now accept full `TTypeInfo extends TypeInfo` instead of just `TItem`
  - `FieldsWithItemType` utility replaced with `FieldsWithTypeInfo`
  - All field builders updated to use new type signature
  - List-level hooks now receive properly typed parameters (may reveal existing type errors)

  ## Benefits
  - ✨ Cleaner code without manual type parameter repetition
  - 🎯 Better type inference in both field-level and list-level hooks
  - 🔄 Consistent type flow from list configuration down to individual fields
  - 🛡️ Maintained full type safety with improved DX
  - 💡 Full IntelliSense support in all hook callbacks

## 0.3.0

## 0.2.0

### Patch Changes

- [#132](https://github.com/OpenSaasAU/stack/pull/132) [`fcf5cb8`](https://github.com/OpenSaasAU/stack/commit/fcf5cb8bbd55d802350b8d97e342dd7f6368163b) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade to Prisma 7 with database adapter support

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

- [#107](https://github.com/OpenSaasAU/stack/pull/107) [`f4f3966`](https://github.com/OpenSaasAU/stack/commit/f4f3966faedba07d2cf412fab826d81e30c63a6c) Thanks [@borisno2](https://github.com/borisno2)! - Add strict typing for plugin runtime services

  This change implements fully typed plugin runtime services, providing autocomplete and type safety for `context.plugins` throughout the codebase.

  **Core Changes:**
  - Extended `Plugin` type with optional `runtimeServiceTypes` metadata for type-safe code generation
  - Converted `OpenSaasConfig` and `AccessContext` from `type` to `interface` to enable module augmentation
  - Plugins can now declare their runtime service type information

  **Auth Plugin:**
  - Added `AuthRuntimeServices` interface defining runtime service types
  - Exported runtime types from package
  - Users now get full autocomplete for `context.plugins.auth.getUser()` and `context.plugins.auth.getCurrentUser()`

  **RAG Plugin:**
  - Added `RAGRuntimeServices` interface defining runtime service types
  - Exported runtime types from package
  - Users now get full autocomplete for `context.plugins.rag.generateEmbedding()` and `context.plugins.rag.generateEmbeddings()`

  **CLI Generator:**
  - Enhanced plugin types generator to import and use plugin runtime service types
  - Generated `.opensaas/plugin-types.ts` now includes proper type imports
  - `PluginServices` interface extends `Record<string, Record<string, any> | undefined>` for type compatibility
  - Maintains backwards compatibility with plugins that don't provide type metadata

  **UI Package:**
  - Updated `AdminUI` props to accept contexts with typed plugin services
  - Ensures compatibility between generated context types and UI components

  **Benefits:**
  - Full TypeScript autocomplete for all plugin runtime methods
  - Compile-time type checking catches errors early
  - Better IDE experience with hover documentation and jump-to-definition
  - Backwards compatible - third-party plugins without type metadata continue to work
  - Zero type errors in examples

  **Example:**

  ```typescript
  const context = await getContext()

  // Fully typed with autocomplete
  context.plugins.auth.getUser('123') // (userId: string) => Promise<unknown>
  context.plugins.rag.generateEmbedding('text') // (text: string, providerName?: string) => Promise<number[]>
  ```

## 0.1.7

### Patch Changes

- 372d467: Add `searchable` helper functions to embeddings
- 372d467: Add sudo to context to bypass access control
- Updated dependencies [372d467]
  - @opensaas/stack-core@0.1.7

## 0.1.6

### Patch Changes

- 39996ca: Fix missing StoredEmbedding type import in generated types. Fields can now declare TypeScript imports needed for their types via the new `getTypeScriptImports()` method. This resolves the type error where `StoredEmbedding` was referenced but not imported in the generated `.opensaas/types.ts` file.
- Updated dependencies [39996ca]
- Updated dependencies [39996ca]
  - @opensaas/stack-core@0.1.6
