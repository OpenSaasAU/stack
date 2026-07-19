---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add a Cell registry with default cells for core field types

List tables now render every value through a **Cell** resolved by a
cell-component registry that mirrors the form-field registry's priority chain:
per-field override → custom type registry → field-type registry → plain-text
fallback. Each core field type ships a default Cell — text (plain), integer
(tabular figures), select (coloured Badge), timestamp (formatted date), checkbox
(mark), and to-one relationship (Item label link). Unknown/third-party types
without a registered Cell fall back to plain text.

Select options gain optional, additive per-option UI metadata mapping a value to
a badge variant. Existing options keep working unchanged; unmapped options render
the neutral badge.

```typescript
// opensaas.config.ts — colour a status value in list-table cells
status: select({
  options: [
    { label: 'Draft', value: 'draft', ui: { variant: 'secondary' } },
    { label: 'Published', value: 'published', ui: { variant: 'success' } },
  ],
})
```

Register a Cell for a custom/third-party field exactly as you register its form
component, or override a single field's Cell:

```typescript
'use client'
import { registerCellComponent } from '@opensaas/stack-ui'
registerCellComponent('myField', MyCell)

// or per-field override (highest priority)
price: integer({ ui: { cell: CurrencyCell } })
```
