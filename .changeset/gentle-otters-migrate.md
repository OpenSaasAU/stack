---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
'@opensaas/stack-cli': minor
---

Add a first-class `bigInt()` field type for 64-bit integers (e.g. a millisecond epoch) that overflow `integer()`'s 32-bit `Int` — Prisma `BigInt`, TypeScript `bigint`, with an admin UI component, filtering, and MCP support.

```typescript
import { bigInt } from '@opensaas/stack-core/fields'

fields: {
  occurredAtMs: bigInt({ validation: { isRequired: true } }),
}

await context.db.event.create({
  data: { occurredAtMs: 9007199254740993n }, // bigint, number, or numeric string
})
```

Create/update accept `bigint`, an integer `number`, or a numeric `string`, and always coerce to `bigint`. A `number` above `Number.MAX_SAFE_INTEGER` is rejected rather than silently losing precision. `bigint` isn't JSON-serialisable, so an MCP CRUD tool renders the value as a decimal string instead of throwing, and the admin UI's server→client boundary (list table, item form, relationship table) now round-trips a `bigint` value correctly rather than throwing during render. The migration introspector maps Prisma `BigInt` columns to `bigInt()` instead of the previous lossy `text()` fallback.
