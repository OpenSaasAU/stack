import type { Session } from '../access/types.js'
import type { RowAction } from './types.js'

export function isRowActionAvailable(
  action: Pick<RowAction, 'key' | 'isAvailable'>,
  listKey: string,
  item: Record<string, unknown>,
  session: Session | null,
): boolean {
  const { isAvailable } = action
  if (!isAvailable) return true
  let result: unknown
  try {
    result = isAvailable({ item, session })
  } catch (error) {
    console.error(`Row action "${action.key}" on "${listKey}" isAvailable threw:`, error)
    return false
  }
  if (typeof result === 'boolean') return result
  if (result instanceof Promise) result.catch(() => undefined)
  console.error(
    `Row action "${action.key}" on "${listKey}" isAvailable returned a non-boolean value; isAvailable must be synchronous, so the action is treated as unavailable.`,
  )
  return false
}
