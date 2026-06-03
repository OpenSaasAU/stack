import { describe, it, expect, expectTypeOf } from 'vitest'
// Import from the package root entry point exactly as the docs / CHANGELOG /
// migrate-context-calls skill instruct consumers to. If the root `index.ts`
// stops re-exporting the query API, this file fails to type-check / run,
// preventing a silent regression (issue #496).
import { defineFragment, runQuery, runQueryOne } from './index.js'
import type { ResultOf, RelationSelector, QueryArgs } from './index.js'

// ─────────────────────────────────────────────────────────────
// Stand-in model type (mirrors a Prisma-generated type)
// ─────────────────────────────────────────────────────────────

type User = {
  id: string
  name: string
  email: string
}

describe('@opensaas/stack-core root entry point — query API re-exports (issue #496)', () => {
  it('re-exports the runtime query functions from the package root', () => {
    expect(typeof defineFragment).toBe('function')
    expect(typeof runQuery).toBe('function')
    expect(typeof runQueryOne).toBe('function')
  })

  it('defineFragment imported from the root produces a usable fragment', () => {
    const userFragment = defineFragment<User>()({ id: true, name: true } as const)

    expect(userFragment._type).toBe('fragment')
    expect(userFragment._fields).toEqual({ id: true, name: true })
  })

  it('exposes ResultOf as a usable type alias from the root', () => {
    const userFragment = defineFragment<User>()({ id: true, name: true } as const)
    expect(userFragment._type).toBe('fragment')

    // Type-level assertion: ResultOf<typeof fragment> narrows to the selection.
    expectTypeOf<ResultOf<typeof userFragment>>().toEqualTypeOf<{ id: string; name: string }>()
  })

  it('exposes QueryArgs and RelationSelector as usable types from the root', () => {
    // Type-level usage — these annotations only compile if the types resolve
    // from the root entry point.
    const args: QueryArgs = { where: { id: 'abc' }, take: 5 }
    expect(args.take).toBe(5)

    const selector: RelationSelector<User> = defineFragment<User>()({ id: true } as const)
    expectTypeOf(selector).not.toBeNever()
  })
})
