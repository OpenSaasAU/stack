---
'@opensaas/stack-cli': minor
---

Consolidate nullability between the standalone `{List}CreateInput`/`{List}UpdateInput` exports and the call-site write-`data` override into a single source of truth (#608).

The generated types previously described a list's create/update input shape in two places that disagreed on how a nullable scalar was represented: the write-`data` override emitted `name?: string | null` (matching Prisma's nullable-column input) while the standalone `{List}CreateInput`/`{List}UpdateInput` emitted `name?: string`. Both paths now render each scalar member through one shared helper, so a nullable scalar is consistently `name?: T | null` in every input representation. Required scalars stay required, and `decimal`/`json`/relationship/multi-column handling is unchanged.

This is a non-breaking type refinement, but if you assigned the standalone `{List}CreateInput`/`{List}UpdateInput` types into a stricter local type, a nullable scalar may now be inferred as `T | null`:

```typescript
// A nullable text() field on Post now generates:
export type PostCreateInput = {
  title: string // required scalar — unchanged
  content?: string | null // nullable scalar — now includes `| null`
}
```
