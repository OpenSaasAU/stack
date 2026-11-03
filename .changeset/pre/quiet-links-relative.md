---
'@opensaas/stack-tiptap': patch
---

`link.allowRelative` now refuses protocol-relative (`//`), backslash and entity-encoded hrefs (a plain `&` in a query string is still allowed).
