---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add `getUIProps` to field builders and eliminate type-based branching in `FieldRenderer`

`BaseFieldConfig` now has an optional `getUIProps(context: UIPropsContext) => Record<string, unknown>` method. All built-in field builders implement it.

`FieldRenderer` no longer checks `fieldConfig.type` to decide which props to pass. Instead it uses data-presence checks on the serialised field config (inspects `fieldConfig.options` for select fields, `fieldConfig.ref` for relationship fields, etc.) — the same approach as `getUIProps`, but safe across RSC boundaries where functions are stripped.

**For third-party field packages:** no changes required. `FieldRenderer` works from the serialised config's data properties, not from `fieldConfig.type`.

**For custom field builders**, you can optionally implement `getUIProps` for code that works with the original (non-serialised) field config:

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
    getZodSchema: (fieldName, operation) => {
      /* … */
    },
    getPrismaType: (fieldName) => {
      /* … */
    },
    getTypeScriptType: () => {
      /* … */
    },
  }
}
```
