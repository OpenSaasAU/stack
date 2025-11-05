---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
'@opensaas/stack-rag': patch
---

Fix missing StoredEmbedding type import in generated types. Fields can now declare TypeScript imports needed for their types via the new `getTypeScriptImports()` method. This resolves the type error where `StoredEmbedding` was referenced but not imported in the generated `.opensaas/types.ts` file.
