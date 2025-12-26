---
'@opensaas/stack-core': minor
---

Export hook argument types for better TypeScript support

You can now import and use hook argument types to annotate your hook parameters, eliminating implicit `any` errors with strict TypeScript settings:

**List-level hooks:**

```typescript
import type { AfterOperationHookArgs } from '@opensaas/stack-core'

Post: list({
  hooks: {
    afterOperation: async (args: AfterOperationHookArgs) => {
      if (args.operation === 'update') {
        console.log('Updated:', args.item)
      }
    },
  },
})
```

**Field-level hooks:**

```typescript
import type { FieldValidateHookArgs } from '@opensaas/stack-core'

fields: {
  email: text({
    hooks: {
      validate: async (args: FieldValidateHookArgs) => {
        if (!args.resolvedData.email?.includes('@')) {
          args.addValidationError('Invalid email')
        }
      },
    },
  })
}
```

**Available types:**

- List-level: `ResolveInputHookArgs`, `ValidateHookArgs`, `BeforeOperationHookArgs`, `AfterOperationHookArgs`
- Field-level: `FieldResolveInputHookArgs`, `FieldValidateHookArgs`, `FieldBeforeOperationHookArgs`, `FieldAfterOperationHookArgs`, `FieldResolveOutputHookArgs`

Additionally, field-level hooks now support `validateInput` as a deprecated alias for `validate` for backwards compatibility with Keystone patterns.
