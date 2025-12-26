---
'@opensaas/stack-cli': minor
---

Add Select and Include types with virtual field support

Virtual fields are now included in generated Select and Include types, enabling proper TypeScript type checking when selecting virtual fields:

```typescript
import type { UserSelect } from '@/.opensaas/types'

// Before: This would cause a type error
const select = {
  id: true,
  name: true,
  displayName: true, // Error: 'displayName' does not exist in Prisma.UserSelect
} satisfies Prisma.UserSelect

// After: Virtual fields work correctly
const select = {
  id: true,
  name: true,
  displayName: true, // ✓ Works! Virtual field is included in UserSelect
} satisfies UserSelect
```

For lists without virtual fields, the generated types simply re-export Prisma's types:

```typescript
export type PostSelect = Prisma.PostSelect
export type PostInclude = Prisma.PostInclude
```

For lists with virtual fields, the types extend Prisma's types:

```typescript
export type UserSelect = Prisma.UserSelect & {
  displayName?: boolean
}
```

This resolves the issue where virtual fields couldn't be used in select/include objects with the `satisfies` operator.
