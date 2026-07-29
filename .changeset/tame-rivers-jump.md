---
'@opensaas/stack-ui': patch
---

Fix the admin item form fetching relationship options serially (N sequential round-trips before first paint). Fetches now run concurrently via `Promise.all`.
