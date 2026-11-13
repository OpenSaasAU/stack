---
'@opensaas/stack-tiptap': patch
---

Fix rich text with a heading, ordered list, link or code block being refused on save: the editor now emits plain objects, not null-prototype ones that server actions encode as `"$T"`.
