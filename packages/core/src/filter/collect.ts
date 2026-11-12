import type { ListConfig, OpenSaasConfig } from '../config/types.js'
import type { Session, AccessContext } from '../access/types.js'
import { checkAccess } from '../access/engine.js'
import { classifyRowIndependentRead, isFieldReadableForPredicate } from '../access/field-access.js'
import { parseFilterQuery } from './parse.js'
import { serializeFilterQuery } from './serialize.js'
import { buildFilterWhere } from './map.js'
import type { FilterCondition, FilterFieldSuggestion, FilterSpec, FilterTerm } from './types.js'

/**
 * The session/context a field's `read` access is evaluated against — the same
 * shape every other access-scoped admin-UI helper takes.
 */
export type FilterAccessArgs = {
  session: Session | null
  context: AccessContext & { _isSudo?: boolean }
}

async function canQueryList(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  args: FilterAccessArgs,
): Promise<boolean> {
  if (args.context._isSudo === true) return true
  return (await checkAccess(listConfig.access?.operation?.query, args)) !== false
}

function hasFilterSpec(field: { getFilterSpec?: unknown; isFilterable?: boolean }): boolean {
  return typeof field.getFilterSpec === 'function' && field.isFilterable !== false
}

/**
 * Resolve every field's {@link FilterSpec} for a list by delegating to each
 * field's optional `getFilterSpec` method. A field without the method (or one
 * whose method returns `undefined`) is simply not filterable — the absence
 * degrades gracefully so third-party fields keep working.
 *
 * A field the session cannot READ is excluded here too (#915), evaluated the
 * same predicate-time way the secured read's own predicates enforce
 * (`isFieldReadableForPredicate` — no fetched row exists yet, so a
 * row-dependent `read` rule resolves to "not filterable"). This is what keeps
 * the admin UI from ever suggesting, autocompleting, or submitting a filter
 * the engine is going to reject: excluding the spec here means a token
 * naming that field degrades to free text (`buildFilterWhere`'s existing
 * "unknown field" path) rather than reaching `context.db` at all.
 *
 * A session denied the list's `query` has nothing to filter, so it gets no specs
 * and no field `read` rule is asked, exactly as a read short-circuits.
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
  if (!(await canQueryList(listConfig, args))) return specs
  const filterableFields = Object.entries(listConfig.fields).filter(([, field]) =>
    hasFilterSpec(field),
  )
  // Each field's read-access check is independent of every other's — run
  // them concurrently rather than serially, since a `read` rule that does
  // async work (e.g. a DB lookup) would otherwise add per-field latency to
  // every list-view page render (found in review of #925).
  const readableFlags = await Promise.all(
    filterableFields.map(([, field]) => isFieldReadableForPredicate(field.access, args)),
  )
  filterableFields.forEach(([fieldName, field], index) => {
    if (!readableFlags[index]) return
    const spec = field.getFilterSpec!(fieldName, listKey, config)
    if (spec) specs[fieldName] = spec
  })
  return specs
}

/**
 * The fields of a list whose `read` rule is row-independent and denies this
 * session, so no row can ever show them: the same omission the MCP vocabulary
 * makes (ADR-0053). A row-dependent rule is not named, and a rule that throws
 * is, so a field this session cannot classify stays hidden. A session denied
 * the list's `query` gets an empty set and no field rule is asked.
 */
export async function collectUnreadableFields(
  listConfig: OpenSaasConfig['lists'][string],
  args: FilterAccessArgs,
): Promise<Set<string>> {
  if (!(await canQueryList(listConfig, args))) return new Set()
  const fields = Object.entries(listConfig.fields)
  const answers = await Promise.all(
    fields.map(([, field]) =>
      classifyRowIndependentRead(field.access, args).catch((): 'deny' => 'deny'),
    ),
  )
  return new Set(fields.flatMap(([name], index) => (answers[index] === 'deny' ? [name] : [])))
}

/**
 * End-to-end helper for the list view: parse a raw URL query, collect the
 * list's Filter specs, and build the merged Prisma `where` fragment. The
 * fragment is meant to be handed to `context.db.<list>.where(…)`, where
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
  return filterSuggestionsOf(await collectFilterSpecs(listConfig, listKey, config, args))
}

/**
 * The client-serializable suggestion metadata for Filter specs already
 * collected with {@link collectFilterSpecs}, so a caller that also builds a
 * `where` from those specs asks each field's `read` rule once.
 */
export function filterSuggestionsOf(specs: Record<string, FilterSpec>): FilterFieldSuggestion[] {
  return Object.entries(specs).map(([field, spec]) => {
    const suggestion: FilterFieldSuggestion = {
      field,
      operators: spec.operators,
      freeText: spec.freeText ?? false,
      valueSource: spec.suggestions.valueSource,
    }
    if (spec.suggestions.valueFormat) suggestion.valueFormat = spec.suggestions.valueFormat
    if (spec.suggestions.datePicker) suggestion.datePicker = spec.suggestions.datePicker
    if (spec.toIdCondition) suggestion.matchesById = true
    if (spec.empty !== undefined) suggestion.canBeEmpty = true
    if (spec.negation !== undefined) suggestion.negation = spec.negation
    return suggestion
  })
}

/**
 * Whether this session may filter one field of a list by a related record's id
 * (`field:#id`): it may query the list, read the field in a predicate, and the
 * field's {@link FilterSpec} has `toIdCondition`. Asks only that field's rules.
 */
export async function isFieldFilterableById(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listKey: string,
  fieldName: string,
  config: OpenSaasConfig,
  args: FilterAccessArgs,
): Promise<boolean> {
  if (!Object.hasOwn(listConfig.fields, fieldName)) return false
  const field = listConfig.fields[fieldName]
  if (!hasFilterSpec(field)) return false
  if (!(await canQueryList(listConfig, args))) return false
  if (!(await isFieldReadableForPredicate(field.access, args))) return false
  return field.getFilterSpec?.(fieldName, listKey, config)?.toIdCondition !== undefined
}

/**
 * A filter query with every token naming one of `fields` removed, a group
 * dropping only its own such alternatives and vanishing when none is left.
 * Neither the field name nor its value survives in the result.
 */
export function withholdFilterFields(query: string, fields: ReadonlySet<string>): string {
  if (fields.size === 0) return query
  const terms: FilterTerm[] = []
  for (const term of parseFilterQuery(query).terms) {
    if (term.kind === 'token') {
      if (term.field === null || !fields.has(term.field)) terms.push(term)
      continue
    }
    const tokens = term.tokens.filter((token) => token.field === null || !fields.has(token.field))
    if (tokens.length > 0) terms.push({ ...term, tokens })
  }
  return serializeFilterQuery({ terms })
}
