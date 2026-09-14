---
'@opensaas/stack-cli': patch
---

Fix the dev-database concurrency test to kill an orphaned `db update` child on any failure path, tighten its overlap-window sample, and log the overlap count on a passing run.
