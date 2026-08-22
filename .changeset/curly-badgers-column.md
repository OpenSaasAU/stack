---
'@opensaas/stack-ui': minor
---

Replace the admin UI's hardcoded `password`/`createdAt`/`updatedAt` default-column exclusion with curation driven by each field's declared `ui.listView.defaultColumn` (issue #1018). The list view, related-list tables, and the `ListTable` standalone component now share one implementation (`computeDefaultColumns`) instead of three independent name/type-matching copies, and a list's structural `createdAt`/`updatedAt` timestamp columns are identified from its own timestamp configuration rather than by name.

**Behavior change:** an application field literally named (or typed) `password`, `createdAt`, or `updatedAt` that does NOT declare `ui.listView.defaultColumn: false` — and isn't your list's actual auto-timestamp column — is no longer hidden from default admin columns purely by name/type match. Real password fields (built with `password()`) and real system timestamps are unaffected; they're excluded via the declared flag instead.

`ListTable` gains an optional `fields?: Record<string, SerializableFieldConfig>` prop to supply this curation metadata; without it (as before), every `fieldTypes` column shows absent an explicit `columns` list.
