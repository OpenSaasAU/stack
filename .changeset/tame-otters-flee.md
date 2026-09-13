---
'@opensaas/stack-core': patch
---

Bypassing the secured read funnel (`visibleRows`) is now a compile error, and a related row deleted between the main read and its companion foreign-key existence check fails closed to `null` — pinned by a regression test rather than left to review.
