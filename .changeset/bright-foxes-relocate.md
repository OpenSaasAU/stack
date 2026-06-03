---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add an `output` config block so `opensaas generate` can relocate the generated Prisma schema and `.opensaas` bundle (e.g. to coexist with an existing Keystone `prisma/` during migration)

Set `output.prismaSchema` and/or `output.opensaasDir` in `opensaas.config.ts` to move where the generator writes. Defaults are unchanged (`prisma/schema.prisma`, `.opensaas/`) when the block is omitted. The generated files' cross-references follow the configured locations: `context.ts`/`prisma-extensions.ts` import `opensaas.config` from the resolved bundle, the Prisma client `generator { output }` points back at the relocated bundle, and the top-level `prisma.config.ts` references the configured schema directory so `prisma` CLI commands keep working.

```typescript
export default config({
  output: {
    prismaSchema: 'prisma-opensaas/schema.prisma',
    opensaasDir: 'generated/opensaas',
  },
  db: {
    /* ... */
  },
  lists: {
    /* ... */
  },
})
```
