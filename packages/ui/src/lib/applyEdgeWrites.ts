'use client'

import type { ServerActionInput } from '../server/types.js'
import type { EdgeSelectionChange, EdgeWriteOutcome } from './useItemForm.js'

/** Read the `{ linked, error? }` outcome the link server action returns. */
export function readLinkOutcome(result: unknown): { ok: boolean; error?: string } {
  if (typeof result === 'object' && result !== null && 'linked' in result) {
    const record = result as { linked?: unknown; error?: unknown }
    return {
      ok: record.linked === true,
      error: typeof record.error === 'string' ? record.error : undefined,
    }
  }
  return { ok: false }
}

/** Read the `{ removed, error? }` outcome the unlink server action returns. */
export function readUnlinkOutcome(result: unknown): { ok: boolean; error?: string } {
  if (typeof result === 'object' && result !== null && 'removed' in result) {
    const record = result as { removed?: unknown; error?: unknown }
    return {
      ok: record.removed === true,
      error: typeof record.error === 'string' ? record.error : undefined,
    }
  }
  return { ok: false }
}

const DENIED = 'Access denied or operation failed'

/**
 * Write one item form's to-many edges as writes against their related lists
 * (ADR-0050).
 *
 * Every write is attempted, so one denied row never hides the outcome of the
 * rest. What comes back is the selection that actually persisted per field —
 * which the form reverts its control to — and the reasons the denials gave.
 */
export async function applyEdgeWrites({
  changes,
  parentId,
  serverAction,
}: {
  changes: EdgeSelectionChange[]
  parentId: string
  serverAction: (input: ServerActionInput) => Promise<unknown>
}): Promise<EdgeWriteOutcome> {
  const persisted: Record<string, string[]> = {}
  const errors: string[] = []

  for (const change of changes) {
    const linked = new Set(change.baseline)

    for (const id of change.removed) {
      const outcome = readUnlinkOutcome(
        await serverAction({
          listKey: change.relatedListKey,
          action: 'removeRelated',
          mode: 'disconnect',
          id,
          field: change.backReferenceField,
        }),
      )
      if (outcome.ok) linked.delete(id)
      else errors.push(outcome.error ?? DENIED)
    }

    for (const id of change.added) {
      const outcome = readLinkOutcome(
        await serverAction({
          listKey: change.relatedListKey,
          action: 'linkRelated',
          id,
          field: change.backReferenceField,
          parentId,
        }),
      )
      if (outcome.ok) linked.add(id)
      else errors.push(outcome.error ?? DENIED)
    }

    persisted[change.fieldName] = [...linked]
  }

  return { persisted, errors }
}
