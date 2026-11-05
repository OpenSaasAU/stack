---
'@opensaas/stack-cli': patch
'@opensaas/stack-auth': patch
---

Fix the generated `rawOpensaasContext` permanently rejecting for the rest of the process if the database wasn't reachable on its first construction attempt (e.g. a cold boot racing the database). It now retries on each `await`, like the client singleton it wraps.

`createAuth()` no longer pre-resolves its `context`/`opensaasConfig` arguments into a fixed `Promise.resolve(...)` at construction time — doing so settled a retryable `rawOpensaasContext` into a plain, permanently-rejected Promise on its first failed attempt, defeating the fix above for the framework's own documented `createAuth(config, rawOpensaasContext)` recipe. It also drops its own internal memo on a failed construction attempt, matching the retry-on-failure pattern used everywhere else in this chain.
