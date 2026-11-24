import { unstable_rethrow } from 'next/navigation.js'
import type { AnyStackContext } from '@opensaas/stack-core'
import type { ListOperation } from '@opensaas/stack-core/internal'
import { vocabularyQuestionsOf } from './vocabularyQuestions.js'
import { readSessionVocabulary } from './sessionFieldConfigs.js'

/**
 * Whether the session's vocabulary for `listKey` leaves `operation` potentially
 * allowed. A list with no vocabulary, or one whose read fails, is denied.
 */
export async function operationAvailable(
  context: AnyStackContext,
  listKey: string,
  operation: ListOperation,
): Promise<boolean> {
  try {
    const questions = vocabularyQuestionsOf(context, listKey)
    return questions !== null && (await questions.operation(operation)) !== 'deny'
  } catch (error) {
    unstable_rethrow(error)
    console.error(`Failed to read the session vocabulary for ${listKey}:`, error)
    return false
  }
}

/**
 * Whether `operation` is allowed on the row `itemId`, with a filter-returning
 * rule resolved against that row. A failed read is denied.
 */
export async function itemOperationAvailable(
  context: AnyStackContext,
  listKey: string,
  itemId: string | number,
  operation: 'update' | 'delete',
): Promise<boolean> {
  try {
    const vocabulary = await readSessionVocabulary(context, listKey, itemId)
    return vocabulary.operations[operation] !== 'deny'
  } catch (error) {
    unstable_rethrow(error)
    console.error(`Failed to resolve ${operation} for ${listKey} ${itemId}:`, error)
    return false
  }
}
