---
'@opensaas/stack-rag': minor
---

Scope the package's Vitest run to `src`, so the suite stops running twice

The `test` turbo task depends on `build`, so `dist/` is present when tests run
and Vitest discovered the compiled `dist/**/*.test.js` duplicates alongside the
sources — every test executed twice, 470 where there are 235. The config now
carries the same `exclude: [...defaultExclude, '**/dist/**']` that
`@opensaas/stack-core` has. Nothing about the package's behaviour changes; the
suite reports honest counts and takes roughly half the CI time (#1311).
