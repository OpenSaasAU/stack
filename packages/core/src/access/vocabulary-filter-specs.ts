import type { FilterSpec } from '../filter/types.js'
import type { FieldQuestions, SessionVocabulary } from './session-vocabulary.js'

const filterSpecsByVocabulary = new WeakMap<SessionVocabulary, ReadonlyMap<string, FilterSpec>>()

const filterSpecByField = new WeakMap<FieldQuestions, () => Promise<FilterSpec | undefined>>()

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

/**
 * The Filter spec of the field `questions` asks about, when it answers
 * filterable, built the one time `filterable` is answered.
 */
export async function fieldFilterSpecOf(
  questions: FieldQuestions,
): Promise<FilterSpec | undefined> {
  return await filterSpecByField.get(questions)?.()
}

/** `questions`, carrying `spec` for {@link fieldFilterSpecOf}. */
export function withFieldFilterSpec(
  questions: FieldQuestions,
  spec: () => Promise<FilterSpec | undefined>,
): FieldQuestions {
  filterSpecByField.set(questions, spec)
  return questions
}
