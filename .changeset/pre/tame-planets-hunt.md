---
'@opensaas/stack-ui': minor
---

The admin item form (create and edit) now respects a field's own CREATE/UPDATE field-level access: a field this session may not write renders read-only, with a reason shown beneath it, instead of an editable control whose value the save would then have to discard.

Previously, any list carrying a field with `access: { create: () => false, update: () => false }` — the default for `embedding()` fields, among others — was uneditable through the admin entirely: the form resubmitted every field on save, and the write pipeline refused the whole update ("Cannot update \"x\": field-level access denied."), leaving even the fields the session could write unsaved.

No config change is required — this is resolved automatically wherever `prepareItemForm` builds a form (the full admin item view, the singleton editor, and the Relationship-table's pre-linked create drawer).
