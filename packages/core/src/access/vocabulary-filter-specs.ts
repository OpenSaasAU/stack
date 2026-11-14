import type { FilterSpec } from '../filter/types.js'
import type { SessionVocabulary } from './session-vocabulary.js'

const filterSpecsByVocabulary = new WeakMap<SessionVocabulary, ReadonlyMap<string, FilterSpec>>()

/**
 * The Filter spec of every field `vocabulary` answers filterable, as the
 * vocabulary built it.
 */
export function filterSpecsOf(vocabulary: SessionVocabulary): ReadonlyMap<string, FilterSpec> {
  return filterSpecsByVocabulary.get(vocabulary) ?? new Map()
}

/** `vocabulary`, carrying `specs` for {@link filterSpecsOf}. */
export function withFilterSpecs(
  vocabulary: SessionVocabulary,
  specs: ReadonlyMap<string, FilterSpec>,
): SessionVocabulary {
  filterSpecsByVocabulary.set(vocabulary, specs)
  return vocabulary
}
