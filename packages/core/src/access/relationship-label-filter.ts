import type { Session, AccessContext } from './types.js'
import type { OpenSaasConfig, ListConfig, FieldConfig } from '../config/types.js'

/**
 * Access-scoped to-one relationship label filters for the admin list view
 * (issue #749) — NOW A PASS-THROUGH.
 *
 * A to-one relationship's Filter spec (`author:Ada` → `{ author: { is: { name:
 * { contains: 'Ada' } } } }`) produces exactly the `{ is: {...} }` shape a
 * relation filter uses. Before #916, the engine did not scope relation
 * filters in `where` at all, so this module was the only place the related
 * list's `query` access was folded into that nested `is` clause (mirroring
 * `relationship-count.ts`'s `_count` folding) — otherwise a session could
 * distinguish parent rows by a related field it could not itself read (e.g.
 * binary-searching `author:A`, `author:Ad`, `author:Ada` against a `User`
 * list it cannot query).
 *
 * #916 closed that gap in the engine itself: `context.db.*.findMany`/`count`
 * now scope every relation filter in `where` — including this exact `is`
 * shape — via `buildAccessScopedWhere` (`access-filter.ts`), applied
 * automatically to whatever `where` this module's caller (`ListView.tsx`)
 * hands to the secured context. Folding the same access filter here as well
 * would be redundant work producing an identical result (the engine ANDs the
 * same filter in a second time), so this module's own fold was removed —
 * `resolveRelationshipLabelFilters` now returns `where` unchanged. The
 * exported functions are kept, unchanged in shape, only because they remain
 * part of `@opensaas/stack-core`'s public surface; removing them outright
 * would be a breaking change this fix does not need to make.
 */

type LabelFilterArgs = {
  session: Session | null
  context: AccessContext
}

/**
 * Whether a field is a to-one relationship — the only field kind whose Filter
 * spec emits a nested `{ is: {...} } }` condition against the related list's
 * label field.
 */
export function isToOneRelationshipField(field: FieldConfig | undefined): boolean {
  return (
    field?.type === 'relationship' &&
    !('many' in field && field.many === true) &&
    'ref' in field &&
    typeof field.ref === 'string' &&
    field.ref.length > 0
  )
}

/**
 * No longer folds access into label filters — see the module doc above.
 * Returns `where` unchanged.
 */
export async function resolveRelationshipLabelFilters(
  where: Record<string, unknown> | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo, kept for API compatibility (see module doc)
  _listConfig: ListConfig<any>,
  _args: LabelFilterArgs,
  _config: OpenSaasConfig,
): Promise<Record<string, unknown> | undefined> {
  return where
}
