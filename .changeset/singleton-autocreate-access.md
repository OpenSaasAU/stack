---
'@opensaas/stack-ui': minor
---

Handle `autoCreate: false` singletons and access-denied reads in the AdminUI singleton editor.

When a singleton's `get()` returns no record, `SingletonView` now disambiguates the two reasons a singleton can be empty and renders the safe affordance:

- **`autoCreate: false` with no row yet** (query + create allowed): renders a create-on-first-save form (reuses `ItemFormClient` in `mode="create"`). Core assigns the singleton `id` and enforces the single-record constraint on save, so the form sends only the user-entered field data.
- **`query` access denied**: renders a friendly "no access" message — never an editable or create form.
- **create denied (autoCreate: false, no row)**: renders a friendly "no record yet" message instead of an unusable form.

An update-denied singleton still renders the edit form, but the save fails gracefully via the server action's denied envelope. The happy path (a record exists → edit form) and non-singleton lists are unchanged.
