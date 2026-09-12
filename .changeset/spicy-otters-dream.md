---
'@opensaas/stack-cli': patch
---

Fix a flaky `dev.test.ts` CI failure caused by a cold module import sitting inside each test's 5-second timeout.
