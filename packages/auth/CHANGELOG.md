# @opensaas/stack-auth

## 1.0.0

### Patch Changes

- f4f3966: Add strict typing for plugin runtime services

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

- Updated dependencies [f4f3966]
  - @opensaas/stack-core@1.0.0

## 0.1.7

### Patch Changes

- Updated dependencies [372d467]
  - @opensaas/stack-core@0.1.7

## 0.1.6

### Patch Changes

- 39996ca: Add plugin mechanism
- Updated dependencies [39996ca]
- Updated dependencies [39996ca]
  - @opensaas/stack-core@0.1.6

## 0.1.5

### Patch Changes

- 17eaafb: Update package urls
- Updated dependencies [17eaafb]
  - @opensaas/stack-core@0.1.5

## 0.1.4

### Patch Changes

- d013859: **BREAKING CHANGE**: Migrate MCP functionality into core and auth packages

  The `@opensaas/stack-mcp` package has been deprecated and its functionality has been split into:
  - `@opensaas/stack-core/mcp` - Auth-agnostic MCP runtime and handlers
  - `@opensaas/stack-auth/mcp` - Better Auth OAuth adapter

  **Migration required:**

  ```typescript
  // Before
  import { createMcpHandlers } from '@opensaas/stack-mcp'
  const { GET, POST, DELETE } = createMcpHandlers({ config, auth, getContext })

  // After
  import { createMcpHandlers } from '@opensaas/stack-core/mcp'
  import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
  const { GET, POST, DELETE } = createMcpHandlers({
    config,
    getSession: createBetterAuthMcpAdapter(auth),
    getContext,
  })
  ```

  **Why this change?**
  - Reduces package count in the monorepo
  - Core package handles auth-agnostic MCP protocol
  - Auth package provides Better Auth specific adapter
  - Better-auth is no longer a dependency of core
  - Enables support for custom auth providers beyond Better Auth

  **New features:**
  - `McpSessionProvider` type for custom auth integration
  - More generic `McpAuthConfig` type supporting custom auth providers
  - Core MCP functionality available without auth dependencies

- Updated dependencies [d013859]
  - @opensaas/stack-core@0.1.4

## 0.1.3

### Patch Changes

- @opensaas/stack-core@0.1.3

## 0.1.2

### Patch Changes

- @opensaas/stack-core@0.1.2

## 0.1.1

### Patch Changes

- f8ebc0e: Add base mcp server
- Updated dependencies [9a3fda5]
- Updated dependencies [f8ebc0e]
- Updated dependencies [045c071]
  - @opensaas/stack-core@0.1.1
