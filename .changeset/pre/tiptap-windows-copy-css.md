---
'@opensaas/stack-tiptap': patch
---

Fix `copy:css` on Windows: replace the POSIX-only `mkdir -p`/`cp` chain with a cross-platform `node -e` call, so the package builds outside a POSIX shell.
