---
'@opensaas/stack-core': minor
---

The core test corpus is organised by guarantee and the coverage ratchet is re-baselined

`packages/core/tests/` is gone. Every suite that stood the engine up on a hand-built
object of `vi.fn()` per-model delegates has been rewritten against the Test context —
an in-process Postgres per Vitest worker, honouring the `DATABASE_URL` escape
(ADR-0057) — and the rest moved beside the module it covers, so the whole corpus now
lives under `packages/core/src/`.

The suites are named for the glossary term they protect: Silent failure, Access Filter,
Field Visibility, the Where vocabulary, the Declared dependency set, the Write Pipeline,
the Row lock and the Engine stamp.

Nothing about writing a test against `@opensaas/stack-core/testing` changes:

```typescript
import { createTestContext } from '@opensaas/stack-core/testing'

const harness = await createTestContext(config, { userId: 'u1' })
await harness.context.db.Post.create({ data: { title: 'ship it' } })
expect(await harness.context.db.Post.all()).toHaveLength(1)
await harness.close()
```

ADR-0002's per-glob coverage ratchet is re-baselined once against the new corpus and
still enforced by `pnpm --filter @opensaas/stack-core test:coverage`. No threshold was
lowered and no path was excluded.
