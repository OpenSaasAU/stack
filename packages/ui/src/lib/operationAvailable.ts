import { unstable_rethrow } from 'next/navigation.js'
import type { AnyStackContext } from '@opensaas/stack-core'
import type { ListOperation } from '@opensaas/stack-core/internal'
import { vocabularyOrDeny } from './sessionFieldConfigs.js'

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
    const vocabulary = await vocabularyOrDeny(context, listKey)
    return vocabulary !== null && vocabulary.operations[operation] !== 'deny'
  } catch (error) {
    unstable_rethrow(error)
    console.error(`Failed to read the session vocabulary for ${listKey}:`, error)
    return false
  }
}
