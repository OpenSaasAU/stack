---
'@opensaas/stack-storage-vercel': patch
---

Fix unique filename generation to use `path.extname` semantics (matching the local provider) so extension-less originals no longer get the whole name appended, and pass through an explicit `cacheControlMaxAge: 0` instead of dropping it.
