import { engineContextOf } from '@opensaas/stack-core'
import type { AnyStackContext } from '@opensaas/stack-core'
import type { SessionVocabularyQuestions } from '@opensaas/stack-core/internal'

/**
 * The session's vocabulary for `listKey`, asked one question at a time, or
 * `null` when the context resolves none for it, which every caller treats as
 * a deny.
 */
export function vocabularyQuestionsOrDeny(
  context: AnyStackContext,
  listKey: string,
): SessionVocabularyQuestions | null {
  return engineContextOf(context)._sessionVocabularyQuestions?.(listKey) ?? null
}

/** Whether `questions` answers `fieldName`'s `read` allow, without asking anything else. */
export async function fieldReadable(
  questions: SessionVocabularyQuestions,
  fieldName: string,
): Promise<boolean> {
  return (await questions.field(fieldName)?.read()) === 'allow'
}
