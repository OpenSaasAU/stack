import { unstable_rethrow } from 'next/navigation.js'
import type { AnyStackContext } from '@opensaas/stack-core'
import type { SessionVocabulary } from '@opensaas/stack-core/internal'
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

export interface ItemOperations {
  canUpdate: boolean
  canDelete: boolean
  /** The row's resolved vocabulary, to hand on so it is resolved once per render. `undefined` when it could not be read. */
  vocabulary: SessionVocabulary | undefined
}

/**
 * What the session may do to the row `itemId`, with a filter-returning rule
 * resolved against that row. A failed read denies both.
 */
export async function itemOperationsOf(
  context: AnyStackContext,
  listKey: string,
  itemId: string | number,
): Promise<ItemOperations> {
  try {
    const vocabulary = await readSessionVocabulary(context, listKey, itemId)
    return {
      canUpdate: vocabulary.operations.update !== 'deny',
      canDelete: vocabulary.operations.delete !== 'deny',
      vocabulary,
    }
  } catch (error) {
    unstable_rethrow(error)
    console.error(`Failed to resolve operations for ${listKey} ${itemId}:`, error)
    return { canUpdate: false, canDelete: false, vocabulary: undefined }
  }
}
