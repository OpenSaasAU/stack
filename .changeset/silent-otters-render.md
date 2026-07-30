---
'@opensaas/stack-ui': patch
---

Fix virtual fields rendering "Unsupported field type: virtual" in the Admin UI item view — they now display their resolved value read-only, and are never offered as an editable control or included in create/update payloads.
