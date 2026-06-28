---
'@opensaas/stack-core': patch
---

Apply a field's defaultValue to omitted inputs before create validation (resolve-then-validate, matching Keystone), so isRequired + defaultValue no longer fails on create.

Note: because an omitted-but-defaulted field is now filled into `resolvedData` before validation, that field's create-side field-level `beforeOperation`/`afterOperation` hooks (gated on the field key being present in `resolvedData`) now fire for defaulted fields where they previously would not.
