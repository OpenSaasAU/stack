---
'@opensaas/stack-core': patch
---

Make non-sudo writes fail loud in `filterWritableFields` (Keystone parity).

Undeclared `data` keys on create/update now throw instead of passing through unchecked (#564), and fields denied by field-level access now throw instead of being silently stripped (#568). `sudo` remains the single trusted bypass; system fields, relationship foreign keys, and multi-column split columns still pass through.
