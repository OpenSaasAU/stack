---
'@opensaas/stack-cli': minor
'@opensaas/stack-core': minor
---

Make the generated `.opensaas/prisma-client` subtree statically resolvable by default and add a `db.prismaGeneratorOptions` passthrough.

The generated `generator client { ... }` block now emits `importFileExtension = "ts"` and `moduleFormat = "esm"` by default, so the prisma-client subtree uses explicit `.ts` import extensions and matches the extension style the rest of the `.opensaas` bundle already uses — the whole import graph is statically resolvable by a bundler out of the box, no post-generation surgery required.

A new optional `db.prismaGeneratorOptions` lets you override these values when you need a different module/extension story (e.g. emitting `.js` extensions for a plain-Node consumer). Any value you supply wins; omitted keys fall back to the `ts`/`esm` defaults. The existing `previewFeatures = ["multiSchema"]` emission (when `db.schemas` is set) is preserved and coexists with the new options.

```typescript
export default config({
  db: {
    provider: 'postgresql',
    prismaGeneratorOptions: {
      importFileExtension: 'js',
      moduleFormat: 'commonjs',
    },
    // ... rest of config
  },
  // ...
})
```
