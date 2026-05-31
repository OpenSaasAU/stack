---
'@opensaas/stack-ui': minor
---

Unify the item-form logic behind a shared `useItemForm` engine

The AdminUI form (`ItemFormClient`) and the standalone `ItemCreateForm`/
`ItemEditForm` each carried their own near-identical copy of the form state,
the relationship-to-`connect` submit transform, the clear-error-on-change
behaviour, and the error/pending handling. That logic now lives once in a
`useItemForm` hook (with pure, exported `transformItemFormData`,
`transformInitialData`, and `getEditableFields` helpers); each form supplies
only an `onSubmit` adapter and renders the returned state.

Behaviour is unified to the superset: every form now applies the relationship
transform, the password `{ isSet }` skip for unchanged passwords, and
system-field filtering. The transform logic is covered by unit tests for the
first time.

No public API change — `ItemCreateForm`, `ItemEditForm`, and the AdminUI form
keep their existing props.
