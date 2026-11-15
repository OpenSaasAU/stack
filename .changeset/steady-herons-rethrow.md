---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Make the framework control-flow rethrow predicate injectable

A new `isFrameworkControlFlow` config option recognises a host framework's control flow thrown from inside an access rule, so the Session vocabulary, MCP's advertised vocabulary and the admin's nav counts let it propagate instead of folding it into a logged deny. It is OR'ed with the built-in recognition of Next.js's digests and React's postpone, and the `cause` walk applies to both.

```typescript
export default config({
  db: { provider: 'postgresql' },
  lists: {},
  isFrameworkControlFlow: (thrown) => thrown instanceof Response,
})
```

`opensaas generate` now wires Next.js's own `unstable_rethrow` into `.opensaas/context.ts` when the project's `package.json` declares `next`, so new Next control-flow signals are recognised without waiting for core to learn their digests. It is imported lazily, so the bundle still loads under plain Node, where it keeps the built-in recognition. Re-run `pnpm generate` to pick it up. A project without `next` gets the same context as before.
