import type { ListConfig, OpenSaasConfig } from '../config/types.js'
import { parseFilterQuery } from './parse.js'
import { buildFilterWhere } from './map.js'
import type { FilterCondition, FilterFieldSuggestion, FilterSpec } from './types.js'

/**
 * Resolve every field's {@link FilterSpec} for a list by delegating to each
 * field's optional `getFilterSpec` method. A field without the method (or one
 * whose method returns `undefined`) is simply not filterable — the absence
 * degrades gracefully so third-party fields keep working.
 *
 * @param listConfig The list whose fields to inspect.
 * @param listKey    The list's key (passed through to each field's spec).
 * @param config     The full config (relationship specs resolve their target
 *   list's label field from it).
 */
export function collectFilterSpecs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listKey: string,
  config: OpenSaasConfig,
): Record<string, FilterSpec> {
  const specs: Record<string, FilterSpec> = {}
  for (const [fieldName, field] of Object.entries(listConfig.fields)) {
    if (typeof field.getFilterSpec !== 'function') continue
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
export function buildListFilterWhere(
  query: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listKey: string,
  config: OpenSaasConfig,
): FilterCondition | undefined {
  const specs = collectFilterSpecs(listConfig, listKey, config)
  const tokens = parseFilterQuery(query)
  return buildFilterWhere(tokens, specs)
}

/**
 * Collect the client-serializable suggestion metadata for a list's filterable
 * fields (field names, operators, enumerated values / relationship label
 * search). Carries no functions, so it can cross the server/client boundary to
 * drive the Filter builder's autocomplete.
 */
export function collectFilterSuggestions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listKey: string,
  config: OpenSaasConfig,
): FilterFieldSuggestion[] {
  const specs = collectFilterSpecs(listConfig, listKey, config)
  return Object.entries(specs).map(([field, spec]) => ({
    field,
    operators: spec.operators,
    freeText: spec.freeText ?? false,
    valueSource: spec.suggestions.valueSource,
  }))
}
