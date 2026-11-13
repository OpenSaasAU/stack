---
'@opensaas/stack-ui': minor
'@opensaas/stack-tiptap': minor
---

The admin now works by keyboard: relationship pickers are ARIA comboboxes, sort headers are buttons, every control is named, and a failed submit focuses the first error.

`FieldRenderer` passes each field an `id` that is unique to the form, so a create drawer and the form under it can share a field name. A built-in field's control no longer has `id` equal to `name`, so a host's `#title` selector or `<label htmlFor="title">` stops matching it. `name` is unchanged, so select with `[name="title"]`.

A custom field should use `id` for its control, and tie its error and help text with the new helpers from `@opensaas/stack-ui/fields`. After a failed submit the form focuses the control marked `aria-invalid`:

```tsx
import {
  FieldError,
  FieldHelp,
  FieldLabel,
  FieldRoot,
  describeField,
  fieldErrorId,
  fieldHelpId,
} from '@opensaas/stack-ui/fields'

export function ColorField({ name, id = name, label, value, onChange, error, helpText }) {
  return (
    <FieldRoot>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        name={name}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        {...describeField(id, { error, helpText })}
      />
      {helpText && <FieldHelp id={fieldHelpId(id)}>{helpText}</FieldHelp>}
      {error && <FieldError id={fieldErrorId(id)}>{error}</FieldError>}
    </FieldRoot>
  )
}
```

Also new: `fieldLabelId` and `fieldValueId` for a button control named by its label and shown value, `TableSortButton` from `@opensaas/stack-ui/primitives`, and `disabled` and `auxiliary` on `ComboboxItem`. `ComboboxEmpty` is now a status line to keep mounted beside `ComboboxList`, passing `null` when there is nothing to say.

File and image fields holding a file now show a Replace control, which carries the field's label and error. The Radix dialog, popover and select packages are pinned exactly so they share one focus and dismiss stack, which is what lets a picker or date popover work inside a drawer.
