---
'@opensaas/stack-ui': patch
---

Item forms set `noValidate` and read the browser's constraint check themselves, so a failed submit focuses the first error, with its message on the field.
