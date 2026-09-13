---
'@opensaas/stack-core': patch
---

Fix the test harness's escape to read `DIRECT_DATABASE_URL`/`DATABASE_URL` in the same order `resolveDatabaseUrl()` does, so a `DIRECT_DATABASE_URL`-only environment runs the suite against that server instead of silently falling back to PGlite.
