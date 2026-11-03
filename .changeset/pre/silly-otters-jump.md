---
'@opensaas/stack-rag': patch
---

Fix flaky `ProcessingQueue` concurrency test: assert peak in-flight processor calls instead of wall-clock duration.
