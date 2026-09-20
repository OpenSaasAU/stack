# Vitest 5 test failures

## Browser shutdown

CI runs 35491744958 and 35280669801 passed all 69 browser tests and printed
coverage, then exhausted Node's heap. The failure reproduces locally with two
workers; the default worker count on the development machine masked it.

Vite's speculative import transforms repeatedly load `packages/ui/dist/index.js`
with changing `sessionId` / `iframeId` query parameters. The iframe path grows
with imported component paths, producing thousands of distinct module IDs after
the tests finish. Tracing `fs.promises.readFile` recorded over 10,000 reads of the
same entry point before exhaustion.

The UI Vitest configuration disables `server.preTransformRequests`. Actual
browser imports still run, with isolation and all coverage reporters retained.
No heap increase or test exclusions are needed.

Regression command (run from `packages/ui`, after building package dependencies):

```sh
CI=true NODE_OPTIONS=--max-old-space-size=512 pnpm test:browser:coverage --maxWorkers=2
```

Before the fix, Node 24.20.0 exhausted a 1 GB heap. After the fix, the same runtime
passed all 8 files / 69 tests and exited successfully with a 512 MB heap. JSON,
JSON summary, and HTML coverage reports were generated.

## Coverage gates

Vitest 5 no longer inherits top-level `coverage.thresholds.perFile` inside glob
thresholds. Core now declares `perFile: true` on each of its three security
critical globs. The numerical thresholds are unchanged, and the core coverage
suite passes with the restored per-file checks.
