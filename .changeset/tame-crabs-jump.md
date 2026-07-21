---
'@opensaas/stack-ui': minor
---

Standalone `ListTable` now routes every cell through the shared cell registry (`CellRenderer`), matching `ListView`. The bespoke relationship renderer and `fieldTypes[column] === 'relationship'` branch are gone in favour of `RelationshipCell`, which already handles link navigation and `stopPropagation`.

A new optional `fieldOptions` prop lets `select` columns resolve label mapping and `ui.variant` badge colour, exactly like `ListView`:

```tsx
<ListTable
  items={posts}
  fieldTypes={{ title: 'text', status: 'select' }}
  fieldOptions={{
    status: [
      { label: 'Published', value: 'published', ui: { variant: 'success' } },
      { label: 'Draft', value: 'draft' },
    ],
  }}
  columns={['title', 'status']}
/>
```

Existing `ListTable` call sites keep working unchanged.
