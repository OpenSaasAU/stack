import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime'
import { currentOrigin, type QueryOrigin } from '../origin.js'

type BeforeCompile = NonNullable<SqlMiddleware['beforeCompile']>

/**
 * Prisma's pre-lowering view of a query — the typed AST and the plan metadata,
 * before the adapter renders SQL. Projected off `SqlMiddleware` rather than
 * imported: `DraftPlan` is declared inside `@prisma/orm-family-sql` and is not
 * on any package's export map.
 */
export type DraftPlan = Parameters<BeforeCompile>[0]

/** One plan a {@link PlanRecorder} saw, and the origin it compiled under. */
export interface RecordedPlan {
  /** The plan's lane, as Prisma reports it on {@link DraftPlan.meta}. */
  readonly lane: DraftPlan['meta']['lane']
  /** The AST's root kind — `'select' | 'insert' | 'update' | 'delete' | …`. */
  readonly kind: DraftPlan['ast']['kind']
  /** The whole typed AST, for asserting on the query the engine built. */
  readonly ast: DraftPlan['ast']
  /** The plan metadata, including the annotations Prisma carries. */
  readonly meta: DraftPlan['meta']
  /**
   * The origin in scope when the plan compiled, read from the same store
   * {@link originTripwire} reads. `undefined` never reaches a recorder
   * registered after the tripwire — the tripwire has already refused.
   */
  readonly origin: QueryOrigin | undefined
}

/** A recording `beforeCompile` and the plans it has seen. */
export interface PlanRecorder {
  /**
   * Register this beside the tripwire in the client's `middleware` array.
   * It rewrites nothing and returns `undefined`, so the plan passes through.
   */
  readonly middleware: SqlMiddleware
  /** Every plan compiled since the last {@link PlanRecorder.clear}, in order. */
  readonly plans: readonly RecordedPlan[]
  /** Drop the recorded plans, typically between tests. */
  clear(): void
}

/**
 * A recording `beforeCompile` middleware — the supported way to assert on the
 * query the engine built (ADR-0057). It is one more entry in the client's
 * `middleware` array, not a seam on the secured wrapper, so the wrapper stays
 * as opaque to a test as it is to a caller and the tripwire is taught nothing.
 *
 * Register it **after** the tripwire so a refusal is still a refusal; the
 * recorder never rewrites a plan and never throws.
 *
 * Assert on `ast` and `origin` — plan shape and origin presence. Never assert
 * on rendered SQL: it is not on the draft, and pinning it would pin Prisma's
 * renderer rather than the stack's behaviour.
 *
 * @example
 * ```typescript
 * const recorder = createPlanRecorder()
 * const db = await createTestDatabase(config, { middleware: [recorder.middleware] })
 * // … run a query …
 * expect(recorder.plans.map((plan) => plan.origin)).toEqual(['engine'])
 * expect(recorder.plans[0].ast.kind).toBe('select')
 * ```
 */
export function createPlanRecorder(): PlanRecorder {
  const plans: RecordedPlan[] = []

  return {
    middleware: {
      name: 'opensaas-plan-recorder',
      familyId: 'sql',
      async beforeCompile(draft: DraftPlan): Promise<undefined> {
        plans.push({
          lane: draft.meta.lane,
          kind: draft.ast.kind,
          ast: draft.ast,
          meta: draft.meta,
          origin: currentOrigin(),
        })
        return undefined
      },
    },
    plans,
    clear: () => {
      plans.length = 0
    },
  }
}
