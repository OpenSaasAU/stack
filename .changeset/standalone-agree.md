---
'@opensaas/stack-ui': minor
'create-opensaas-app': patch
---

Standalone components report their outcome, and behave like the admin

`ItemCreateForm` clears and says "Created." after a successful create.
`ItemEditForm` says "Saved." after a save. Save with nothing changed now says
"No changes to save." and calls `onUnchanged` only. It no longer falls back to
`onCancel`, so pass `onUnchanged` to keep leaving the form:

```tsx
<ItemEditForm
  fields={fields}
  initialData={initialData}
  onSubmit={save}
  onCancel={close}
  onUnchanged={close}
/>
```

When a handler throws, the forms and `DeleteButton` now say the outcome is
unknown instead of showing the browser's raw error. `DeleteButton`'s error is
now announced to screen readers.

`ListTable` sorts numbers by value and dates by time, with empty values last.
Rows with `onRowClick` can be opened with the keyboard.

`SearchBar`'s ✕ clears the search as well as the box. Its own navigation keeps
the page's other parameters and starts at page 1.
