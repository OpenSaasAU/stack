---
'@opensaas/stack-ui': patch
---

Fix `build:css` on Windows: replace the POSIX-only `mkdir -p` with a cross-platform `node -e` call, so the package builds outside a POSIX shell.
