---
'@opensaas/stack-core': patch
'@opensaas/stack-auth': patch
'@opensaas/stack-rag': patch
'@opensaas/stack-cli': patch
---

Add strict typing for plugin runtime services

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
context.plugins.auth.getUser('123')  // (userId: string) => Promise<unknown>
context.plugins.rag.generateEmbedding('text')  // (text: string, providerName?: string) => Promise<number[]>
```
