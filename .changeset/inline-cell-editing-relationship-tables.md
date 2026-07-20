---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add inline cell editing to admin Relationship tables

Cells in a to-many Relationship table on the item view are now editable in place.
Click a cell to edit it, commit with Enter or blur, cancel with Escape. Each
commit is a single-field update on the **related** row through the secured
context, so the related list's own operation- and field-level update access plus
its hooks/validation apply — never the parent's. The update is optimistic and
reverts, with a visible reason, on a Silent failure (access denied / row gone) or
a validation error (inline field errors surface too). Committed values re-render
through the Cell registry, so select cells stay coloured badges.

A field the session cannot write — or a table whose related-list update access is
statically denied — renders read-only with no edit affordance; row-level
(filter-scoped) denials surface at commit as a revert. Non-editable cells keep
click-to-navigate; main list tables are unchanged (this is Relationship-table
only).

- `@opensaas/stack-core`: the generic server action gains a distinct
  `updateRelated` result shape (`{ updated, error?, fieldErrors? }`), and
  `checkFieldAccess` is exposed on `@opensaas/stack-core/internal` so the UI can
  decide the edit affordance without a parallel field-access evaluator.
- `@opensaas/stack-ui`: `RelationshipTableClient` accepts `editableColumns`; the
  editable cell reuses the field-component registry for its editor and the Cell
  registry for its display (new Slots: `relationship-table-cell-display`,
  `relationship-table-cell-editor`, `relationship-table-cell-edit-trigger`,
  `relationship-table-cell-error`).
