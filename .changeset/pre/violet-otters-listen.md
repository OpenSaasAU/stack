---
'@opensaas/stack-rag': minor
'@opensaas/stack-ui': minor
---

Render `embedding()` fields in the admin UI, and stop serialising vectors to the browser

The `embedding` field type had no admin UI component, so every embedding column
rendered as `Unsupported field type: embedding`. Worse, the item form still sent
the field's value back on save, which the field's own write deny then refused —
so **an item with an embedding field could not be saved from the admin UI at
all** (`Validation failed: Cannot update "contentEmbedding": field-level access
denied.`).

`@opensaas/stack-rag/components/register` registers a read-only renderer for the
field and a list-table Cell. The registries live in the browser bundle, so the
import belongs in a client component:

```tsx
// app/admin/[[...admin]]/FieldRegistration.tsx
'use client'

import '@opensaas/stack-rag/components/register'

export function FieldRegistration() {
  return null
}
```

```tsx
// app/admin/[[...admin]]/page.tsx
<>
  <FieldRegistration />
  <AdminUI context={context} config={config} /* ... */ />
</>
```

`ui.showVector` and `ui.showMetadata` were a documented surface with nothing
behind them; they now drive that renderer — and the page payload, not just the
display. A vector the admin UI does not render is no longer serialised to the
browser, so the default (`showVector: false`) keeps a 768- or 1536-float array
out of every admin page:

```typescript
contentEmbedding: embedding({
  sourceField: 'content',
  ui: { showVector: true }, // opt in to rendering (and shipping) the vector
})
```

An embedding is also out of the default list-table columns, since a vector is
unreadable in a table; naming it in `ui.listView.initialColumns` still shows it.

In `@opensaas/stack-ui`, a field's `ui.valueForClientSerialization` now runs on
the list-view path as well as the item form. The list table serialises whole
rows rather than only the columns it renders, so a field withheld from the
default columns still reached the browser in full. Any field declaring that
transform now has it honoured on both paths.
