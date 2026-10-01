---
'@opensaas/stack-tiptap': patch
---

`richText()` now only accepts a Tiptap document (`{ type: 'doc', … }`) of at most 1,000,000 characters of JSON; a required field also rejects an empty document.
