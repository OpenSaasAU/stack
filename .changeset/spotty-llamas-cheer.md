---
'@opensaas/stack-core': patch
---

Apply a field's defaultValue to omitted inputs before create validation (resolve-then-validate, matching Keystone), so isRequired + defaultValue no longer fails on create.
