---
'@opensaas/stack-cli': patch
---

Fix `dev.test.ts` flaking in CI: the cold `./dev.js` import no longer sits inside a test's 5s timeout, and a timed-out test can no longer leak a spawn call into the next test.
