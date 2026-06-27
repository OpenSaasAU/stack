---
'@opensaas/stack-cli': minor
'@opensaas/stack-core': minor
---

Add an opt-in **Node build** of the generated `.opensaas/` bundle (ADR-0011, #579).

Setting `output: { buildTarget: 'node' }` in `opensaas.config.ts` makes `opensaas generate` additionally compile the bundle to a plain-Node-loadable ESM form under `.opensaas/dist/` — `.js` + `.d.ts` with a `{"type":"module"}` marker — alongside the default `.ts` bundler form. The compiled entry is `.opensaas/dist/context.js`, with the Prisma client subtree at `.opensaas/dist/prisma-client/**` and the project config compiled in as a sibling, so a live module (e.g. better-auth's Prisma adapter) can be imported in a bundler-less runtime — plain Node, a Playwright e2e helper, or a build-time script — that the default `.ts` form cannot execute.

The Node build is purely additive: with `output.buildTarget` absent (the default), generation behaves exactly as before and no `.opensaas/dist/` is emitted.

```typescript
// opensaas.config.ts
export default config({
  output: { buildTarget: 'node' },
  // ...
})

// then, from a plain-Node consumer (no bundler, no tsx):
import { createAuth } from '@opensaas/stack-auth/server'
import { config, rawOpensaasContext } from './.opensaas/dist/context.js'

const auth = createAuth(config, rawOpensaasContext)
await auth.api.signUpEmail({ body: { email, password, name } })
```

The compile runs via the TypeScript compiler API with `rewriteRelativeImportExtensions` (turning the bundle's `.ts`-extension imports into runnable `.js` specifiers), `declaration`, `skipLibCheck`, and `noEmitOnError: false`, so it reuses the bundle's type-clean guarantee without adding a build dependency. `'node'` is the only `buildTarget` today; the field is a string-literal union so future compiled targets can be added without a breaking change.
