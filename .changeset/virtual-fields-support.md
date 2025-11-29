---
"@opensaas/stack-core": minor
"@opensaas/stack-cli": minor
"@opensaas/stack-ui": minor
---

Add support for virtual fields with proper TypeScript type generation

Virtual fields are computed fields that don't exist in the database but are added to query results at runtime. This feature enables derived or computed values to be included in your API responses with full type safety.

**New Features:**

- Added `virtual()` field type for defining computed fields in your schema
- Virtual fields are automatically excluded from database schema and input types
- Virtual fields appear in output types with full TypeScript autocomplete
- Virtual fields support `resolveOutput` hooks for custom computation logic

**Type System Improvements:**

- Generated Context type now properly extends AccessContext from core
- Separate Input and Output types (e.g., `UserOutput` includes virtual fields, `UserCreateInput` does not)
- UI components now accept `AccessContext<any>` for better compatibility with custom context types
- Type aliases provide convenience (e.g., `User = UserOutput`)

**Example Usage:**

```typescript
import { list, text, virtual } from '@opensaas/stack-core'

export default config({
  lists: {
    User: list({
      fields: {
        name: text(),
        email: text(),
        displayName: virtual({
          type: 'string',
          hooks: {
            resolveOutput: async ({ item }) => {
              return `${item.name} (${item.email})`
            }
          }
        })
      }
    })
  }
})
```

The `displayName` field will automatically appear in query results with full TypeScript support, but won't be part of create/update operations or the database schema.
