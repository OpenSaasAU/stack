---
'@opensaas/stack-tiptap': patch
---

Reject richText documents nested deeper than 100 levels with an explicit iterative check, instead of relying on `JSON.stringify` overflowing the stack (which Node 26 no longer does).
