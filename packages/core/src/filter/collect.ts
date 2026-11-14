import type { ListConfig, OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import type { SessionVocabulary } from '../access/session-vocabulary.js'
import { filterSpecsOf } from '../access/vocabulary-filter-specs.js'
import {
  EngineContextUnavailableError,
  engineContextOf,
  type AnyStackContext,
} from '../context/engine-context.js'
import { parseFilterQuery } from './parse.js'
import { serializeFilterQuery } from './serialize.js'
import { buildFilterWhere } from './map.js'
import type { FilterCondition, FilterFieldSuggestion, FilterSpec, FilterTerm } from './types.js'

/**
 * The context whose own session and config the filter answers for. Pass the
 * context `getContext()` (or `createTestContext`) built: any other context
 * gets no Filter specs.
 */
export type FilterAccessArgs = {
  context: AnyStackContext
}

function engineOf(context: AnyStackContext): AccessContext | null {
  try {
    return engineContextOf(context)
  } catch (error) {
    if (error instanceof EngineContextUnavailableError) return null
    throw error
  }
}

async function vocabularyOf(
  listKey: string,
  args: FilterAccessArgs,
): Promise<SessionVocabulary | null> {
  return (await engineOf(args.context)?._sessionVocabulary?.(listKey)) ?? null
}

/**
 * The {@link FilterSpec} of every field the context's own
 * {@link SessionVocabulary} answers filterable, as each field's optional
 * `getFilterSpec` built it once for that context. A field the session cannot
 * read in a predicate, including one whose `read` rule is row-dependent or
 * throws, has no spec, and neither does a field with `isFilterable: false`, a
 * field whose spec builder throws, or any field of a singleton, so a token
 * naming it degrades to free text and never reaches `context.db` (ADR-0031,
 * ADR-0084). A session denied the list's `query`, and a context core did not
 * build, get no specs; neither throws.
 *
 * The specs are built from the context's own config, for the context's own
 * session.
 *
 * @param listConfig The list whose fields to report: its config entry in the
 *   context's own config. A field the context's config does not declare gets
 *   no spec.
 * @param listKey    The list's key.
 * @param config     The context's own config. Kept for signature stability;
 *   the specs are built from the config the context carries.
 * @param args       The context whose session and config the specs answer for.
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
  const built = filterSpecsOf(vocabulary)
  for (const fieldName of Object.keys(listConfig.fields)) {
    const spec = built.get(fieldName)
    if (spec !== undefined) specs[fieldName] = spec
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
 * Whether the context's session may filter one field of a list by a related
 * record's id (`field:#id`): its {@link SessionVocabulary} answers the field
 * filterable, and the field's {@link FilterSpec} has `toIdCondition`. False,
 * never a throw, for a context core did not build. The arguments are as
 * {@link collectFilterSpecs} takes them.
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
  if (vocabulary === null) return false
  return filterSpecsOf(vocabulary).get(fieldName)?.toIdCondition !== undefined
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
