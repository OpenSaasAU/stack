---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add `getUIProps` to field builders, eliminating type-based branching in `FieldRenderer`

`BaseFieldConfig` now has an optional `getUIProps(context: UIPropsContext) => Record<string, unknown>` method. All built-in field builders implement it, and `FieldRenderer` delegates to it instead of checking `fieldConfig.type`.

**For third-party field packages:** no changes required. Fields that omit `getUIProps` continue to work via a data-presence fallback in `FieldRenderer`.

**For custom field builders that need to pass extra UI props**, add `getUIProps` to your field config:

```typescript
import type { UIPropsContext } from '@opensaas/stack-core'

export function myField(options) {
  return {
    type: 'myField',
    ...options,
    getUIProps: (context: UIPropsContext) => ({
      myOption: options.myOption,
    }),
    // existing methods…
    getZodSchema: (fieldName, operation) => { /* … */ },
    getPrismaType: (fieldName) => { /* … */ },
    getTypeScriptType: () => { /* … */ },
  }
}
```
