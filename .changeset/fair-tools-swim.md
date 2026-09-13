---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Fix the generated context's client singleton so "once per process" holds in every environment, not only outside production: two bundler-duplicated copies of `.opensaas/context.ts` now share one client through a process-wide registry instead of each opening its own pool (ADR-0070).
