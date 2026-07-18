---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Wire field help text through the admin renderer via `ui.description`

Field authors can now set help/description text on a field's `ui.description`
and have it render beneath the control in the prebuilt admin UI. `FieldRenderer`
surfaces `ui.description` to the rendered field component as its `helpText` prop,
which displays through the shared field-shell `FieldHelp` (data-slot="field-help").
Previously `helpText` only worked when a field component was composed by hand.

```typescript
fields: {
  slug: text({
    ui: { description: 'URL-friendly identifier, lowercase only.' },
  }),
}
```

The option is optional and non-breaking; fields without a description render no
help text, exactly as before.
