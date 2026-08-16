import type { ListConfig, OpenSaasConfig } from '../config/types.js'
import type { Session, AccessContext } from '../access/types.js'
import { isFieldReadableForPredicate } from '../access/field-access.js'
import { parseFilterQuery } from './parse.js'
import { buildFilterWhere } from './map.js'
import type { FilterCondition, FilterFieldSuggestion, FilterSpec } from './types.js'

/**
 * The session/context a field's `read` access is evaluated against — the same
 * shape every other access-scoped admin-UI helper takes (e.g.
 * `resolveRelationshipCountFilters`, `resolveRelationshipLabelFilters`).
 */
export type FilterAccessArgs = {
  session: Session | null
  context: AccessContext & { _isSudo?: boolean }
}

/**
 * Resolve every field's {@link FilterSpec} for a list by delegating to each
 * field's optional `getFilterSpec` method. A field without the method (or one
 * whose method returns `undefined`) is simply not filterable — the absence
 * degrades gracefully so third-party fields keep working.
 *
 * A field the session cannot READ is excluded here too (#915), evaluated the
 * same predicate-time way `context.db.*`'s `findMany`/`count` now enforce
 * (`isFieldReadableForPredicate` — no fetched row exists yet, so a
 * row-dependent `read` rule resolves to "not filterable"). This is what keeps
 * the admin UI from ever suggesting, autocompleting, or submitting a filter
 * the engine is going to reject: excluding the spec here means a token
 * naming that field degrades to free text (`buildFilterWhere`'s existing
 * "unknown field" path) rather than reaching `context.db` at all.
 *
 * @param listConfig The list whose fields to inspect.
 * @param listKey    The list's key (passed through to each field's spec).
 * @param config     The full config (relationship specs resolve their target
 *   list's label field from it).
 * @param args       The session/context to evaluate field-level `read` access
 *   against.
 */
export async function collectFilterSpecs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listKey: string,
  config: OpenSaasConfig,
  args: FilterAccessArgs,
): Promise<Record<string, FilterSpec>> {
  const specs: Record<string, FilterSpec> = {}
  for (const [fieldName, field] of Object.entries(listConfig.fields)) {
    if (typeof field.getFilterSpec !== 'function') continue
    const readable = await isFieldReadableForPredicate(field.access, args)
    if (!readable) continue
    const spec = field.getFilterSpec(fieldName, listKey, config)
    if (spec) specs[fieldName] = spec
  }
  return specs
}

/**
 * End-to-end helper for the list view: parse a raw URL query, collect the
 * list's Filter specs, and build the merged Prisma `where` fragment. The
 * fragment is meant to be handed to `context.db.<list>.findMany`/`count`, where
 * the secured context ANDs it with the access filter — so the filter can only
 * ever narrow, never widen, what a session may see.
 *
 * @returns A `where` fragment, or `undefined` when the query filters nothing.
 */
export async function buildListFilterWhere(
  query: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listKey: string,
  config: OpenSaasConfig,
  args: FilterAccessArgs,
): Promise<FilterCondition | undefined> {
  const specs = await collectFilterSpecs(listConfig, listKey, config, args)
  const tokens = parseFilterQuery(query)
  return buildFilterWhere(tokens, specs)
}

/**
 * Collect the client-serializable suggestion metadata for a list's filterable
 * fields (field names, operators, enumerated values / relationship label
 * search). Carries no functions, so it can cross the server/client boundary to
 * drive the Filter builder's autocomplete.
 */
export async function collectFilterSuggestions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listKey: string,
  config: OpenSaasConfig,
  args: FilterAccessArgs,
): Promise<FilterFieldSuggestion[]> {
  const specs = await collectFilterSpecs(listConfig, listKey, config, args)
  return Object.entries(specs).map(([field, spec]) => ({
    field,
    operators: spec.operators,
    freeText: spec.freeText ?? false,
    valueSource: spec.suggestions.valueSource,
  }))
}
