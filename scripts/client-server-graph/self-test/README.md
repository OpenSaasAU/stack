Fixtures for `pnpm check:client-server-graph --self-test`.

`packages/core` stands in for `@opensaas/stack-core`: its root entry reaches `node:async_hooks` through
`origin.ts`, and its `client-safe` entry reaches only a pure module. Every `'use client'` module in
`packages/app/src` named `bad-*` must be reported and every one named `good-*` must not, so a regression
in the checker, or a deleted fixture, fails the self-test rather than passing quietly.

Nothing else in the repository compiles these files; the checker reads them exactly as it reads a real
package.
