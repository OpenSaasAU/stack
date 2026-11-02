---
'@opensaas/stack-core': patch
---

Fix three Dev database robustness gaps: `resolveDatabaseUrl()` now treats a state file whose pid is live but not this sidecar (a reboot or pid wrap) as stale; `startDevDatabase` refuses a second call against a `dataDir` already in use instead of racing it; and a relative `dataDir` now resolves against the same root as the state file.
