---
'@opensaas/stack-ui': patch
---

Refuse to submit an item form while a JSON, decimal or bigInt field holds input it can't parse, or a password is unconfirmed, and focus the first invalid field.
Third-party fields can report the same through the new `useFieldValidity` hook.
