---
'@opensaas/stack-ui': minor
---

Password columns are now identified by field type, not field name, across the list view, standalone `ListTable`, and item-view Relationship tables. A field declared `secret: password()` is now excluded from default columns even though it isn't named `password`; a field merely named `password` (e.g. `password: text()`) is no longer excluded unless it is actually a `password()` field.

A `password` Cell is now registered in the cell registry, so a password-typed column shown via an explicit `columns` prop renders a fixed `••••••••` mask instead of the raw value.

BREAKING (shipped as minor — pre-1.0 packages ship breaking changes as minor): the unused `getFieldDisplayValue` export has been removed from `@opensaas/stack-ui`. It had no callers in the rendering path — Cells render each field type directly — so nothing in this package depended on it; a consumer importing it directly should port to a project-local formatter.
