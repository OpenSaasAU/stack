import type { ListConfig, OpenSaasConfig } from '../config/types.js'
import type { Session, AccessContext } from '../access/types.js'
import type { SessionVocabulary } from '../access/session-vocabulary.js'
import { engineContextOf } from '../context/engine-context.js'
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

async function vocabularyOf(
  listKey: string,
  args: FilterAccessArgs,
): Promise<SessionVocabulary | null> {
  return (await engineContextOf(args.context)._sessionVocabulary?.(listKey)) ?? null
}

/**
 * Resolve the {@link FilterSpec} of every field the session's
 * {@link SessionVocabulary} answers filterable, by delegating to each field's
 * optional `getFilterSpec` method. A field the session cannot read in a
 * predicate, including one whose `read` rule is row-dependent or throws, has
 * no spec, so a token naming it degrades to free text and never reaches
 * `context.db` (ADR-0031, ADR-0084). A session denied the list's `query`, and
 * a context core did not build, get no specs.
 *
 * @param listConfig The list whose fields to inspect.
 * @param listKey    The list's key (passed through to each field's spec).
 * @param config     The full config (relationship specs resolve their target
 *   list's label field from it).
 * @param args       The context whose session the vocabulary is resolved for.
 */
export async function collectFilterSpecs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listKey: string,
  config: OpenSaasConfig,
  args: FilterAccessArgs,
): Promise<Record<string, FilterSpec>> {
  const specs: Record<string, FilterSpec> = {}
  const vocabulary = await vocabularyOf(listKey, args)
  if (vocabulary === null) return specs
  for (const [fieldName, field] of Object.entries(listConfig.fields)) {
    if (vocabulary.fields.get(fieldName)?.filterable !== true) continue
    const spec = field.getFilterSpec?.(fieldName, listKey, config)
    if (spec) specs[fieldName] = spec
  }
  return specs
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
 * (`field:#id`): its {@link SessionVocabulary} answers the field filterable,
 * and the field's {@link FilterSpec} has `toIdCondition`.
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
  const vocabulary = await vocabularyOf(listKey, args)
  if (vocabulary?.fields.get(fieldName)?.filterable !== true) return false
  const field = listConfig.fields[fieldName]
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
