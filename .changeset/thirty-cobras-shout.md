---
'@opensaas/stack-ui': patch
---

Fix Save failing on the edit page for any list with a `many: true` relationship table: strip the synthetic `_count` payload before it reaches the details form data, and harden `transformItemFormData` to drop any submitted key with no matching field.
