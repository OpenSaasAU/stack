---
'@opensaas/stack-ui': minor
---

Restyle every primitive onto the design system tokens, with a stable `data-slot` contract and a tailwind-merge'd `className` on every part

Following Button (#705), all remaining primitives — Input, Textarea, Label,
Checkbox, Card, Table, Dialog, Select, Popover, Calendar, TimePicker,
DateTimePicker, and Combobox — now consume only theme tokens (no hardcoded
colours or shadows remain; e.g. the Dialog no longer uses `bg-white` /
`border-gray-200` / `shadow-2xl` / `bg-black/80`).

Every primitive and composite part now carries a documented, stable `data-slot`
attribute, and merges a caller `className` via tailwind-merge so instance
overrides win:

```tsx
// Instance override (tailwind-merge — caller wins over the default radius)
<Card className="rounded-none" />

// Deep restyle from plain CSS, no Tailwind pipeline required (ADR-0016)
[data-slot='table-row']:nth-child(even) { background: rgba(0, 0, 0, 0.04); }
```

The `data-slot` name set is a public compatibility promise. Full contract:
`input`, `textarea`, `label`, `checkbox`, `checkbox-indicator`, `card`,
`card-header`, `card-title`, `card-description`, `card-content`, `card-footer`,
`table-container`, `table`, `table-header`, `table-body`, `table-footer`,
`table-row`, `table-head`, `table-cell`, `table-caption`, `dialog-overlay`,
`dialog-content`, `dialog-header`, `dialog-footer`, `dialog-title`,
`dialog-description`, `dialog-close`, `select-trigger`, `select-content`,
`select-viewport`, `select-label`, `select-item`, `select-separator`,
`select-scroll-up-button`, `select-scroll-down-button`, `popover-content`,
`calendar`, `time-picker`, `datetime-picker`, `combobox-trigger`,
`combobox-content`, `combobox-search`, `combobox-list`, `combobox-empty`,
`combobox-item`, `combobox-separator` (plus `button` from #705).
