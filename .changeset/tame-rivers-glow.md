---
'@opensaas/stack-ui': minor
'@opensaas/stack-tiptap': minor
---

Render `json()` and `richText()` fields in the admin list view

Neither field type had a registered list-table Cell, so a column of either type
rendered the literal text `[object Object]` in every row (the renderer fell back to
`TextCell`, which stringifies whatever it is given). Both now have a dedicated Cell,
registered under their field type with no wiring needed:

```typescript
// opensaas.config.ts
fields: {
  metadata: json(), // renders "Object (3 keys)" / "Array (2 items)" in the list view
}
```

`json()`'s Cell (`JsonCell`, exported from `@opensaas/stack-ui`) shows a compact shape/size
summary rather than the raw payload.

`richText()`'s Cell (`TiptapCell`) shows a short plain-text excerpt of the document. It
registers alongside the existing form component through the same side-effect import:

```typescript
// lib/register-fields.ts
'use client'
import '@opensaas/stack-tiptap/components/register'
```

Consumers who previously called `registerFieldComponent('richText', TiptapField)` directly
can keep doing so — `registerCellComponent('richText', TiptapCell)` from
`@opensaas/stack-tiptap/components` is the addition, and the new `components/register`
subpath is a convenience that does both at once.

Separately, a field type with **no** Cell at all — a future or third-party type nobody has
registered one for — no longer falls back to `String(value)`. `TextCell`'s fallback now
renders an explicit "Unsupported value" placeholder for an object or array value, rather
than silently producing `[object Object]`.
