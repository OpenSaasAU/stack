---
'@opensaas/stack-ui': minor
---

Design system pass for field components and standalone composites: token-only styling, structured `classNames` slots, status tokens, and shared form rhythm.

**Field components** now share one label / help / error rhythm via a small shell (`FieldRoot`, `FieldLabel`, `FieldHelp`, `FieldError`, `FieldWarning`, `FieldReadValue`). Every field consumes theme tokens only — the previously hardcoded status colours (a green upload check, an amber JSON warning) now use the `success` / `warning` tokens. All fields accept a consistent `helpText` prop.

**Composites accept structured, strongly-typed `classNames` slots** merged per part via tailwind-merge, and every part carries a stable `data-slot`:

- `ListTable` — `classNames={{ root, frame, table, header, headerRow, headerCell, body, row, cell, actionsHeader, actionsCell, empty }}`; root `data-slot="list-table"`.
- `SearchBar` — `classNames={{ root, form, inputWrapper, input, clearButton, submit }}`; root `data-slot="search-bar"`.
- `DeleteButton` — `classNames={{ button, error }}`; error `data-slot="delete-button-error"`.
- `ItemCreateForm` / `ItemEditForm` — `classNames={{ root, error, fields, actions, submit, cancel }}`; roots `data-slot="item-create-form"` / `"item-edit-form"`.
- `RelationshipManager` — `classNames={{ root, label, frame, row, cell, emptyState, actions, connectButton, error }}`; root `data-slot="relationship-manager"`.

**New `Badge` primitive** for status rendering, with `success` / `warning` / `destructive` / `default` / `secondary` / `outline` variants driven entirely by tokens:

```tsx
import { Badge } from '@opensaas/stack-ui/primitives'

;<Badge variant={post.status === 'published' ? 'success' : 'warning'}>{post.status}</Badge>
```

Example: restyle just the rows of a table without forking it:

```tsx
<ListTable
  items={posts}
  fieldTypes={{ title: 'text', status: 'select' }}
  classNames={{ frame: 'shadow-sm', headerCell: 'uppercase text-xs', row: 'hover:bg-accent/40' }}
/>
```
