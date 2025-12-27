---
'@opensaas/stack-cli': minor
---

Add GetPayload helper types for virtual fields

Virtual fields are now fully type-safe in Prisma select queries. The type generator now creates `{ListName}GetPayload<T>` helper types that conditionally include virtual fields based on selection.

Before this change, virtual fields were not recognized in Prisma select types:

```typescript
import { Prisma } from '@/.opensaas/prisma-client/client'

const select = {
  id: true,
  age: true, // ❌ TS Error: 'age' does not exist in type 'StudentSelect'
} satisfies Prisma.StudentSelect
```

After this change, you can use the generated types from `.opensaas/types`:

```typescript
import { StudentSelect, StudentGetPayload } from '@/.opensaas/types'

const studentSelect = {
  id: true,
  firstName: true,
  age: true, // ✅ Virtual field - fully typed!
} satisfies StudentSelect

type StudentDetail = StudentGetPayload<{ select: typeof studentSelect }>
// ✅ StudentDetail includes: { id: string, firstName: string, age: number }
```

The helper type only includes virtual fields that are explicitly selected:

```typescript
const basicSelect = {
  id: true,
  firstName: true,
  // age NOT selected
} satisfies StudentSelect

type BasicStudent = StudentGetPayload<{ select: typeof basicSelect }>
// ✅ BasicStudent includes: { id: string, firstName: string }
// age is NOT included
```

No migration needed - this is purely additive. Existing code continues to work, and you can adopt the new types incrementally by:

1. Running `pnpm generate` to regenerate types
2. Importing from `.opensaas/types` instead of `@/.opensaas/prisma-client/client`
3. Using `{ListName}Select` and `{ListName}GetPayload<T>` for type-safe virtual field queries
