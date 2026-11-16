Fixtures for `pnpm check:client-server-graph --self-test`.

`packages/core` stands in for `@opensaas/stack-core`: its root entry reaches `node:async_hooks` through
`origin.ts`, and its `client-safe` entry reaches only a pure module. Every `'use client'` module in
`packages/app/src` on the checker's `SELF_TEST_BAD` list must be reported and every one on
`SELF_TEST_GOOD` must not. Each listed fixture must also be discovered as a root, and a root on neither list
fails, so a regression in the checker, a deleted fixture, or a fixture whose directive changed fails the
self-test rather than passing quietly.

Nothing else in the repository compiles these files; the checker reads them exactly as it reads a real
package.
