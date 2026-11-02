import { readPluginOwnedRows } from '@opensaas/stack-core/extend'
import type { AccessContext } from '@opensaas/stack-core'

export async function isAssetReferenced(args: {
  context: AccessContext
  listKey: string
  filename: string
  read: (row: Record<string, unknown>) => unknown
}): Promise<boolean> {
  const { context, listKey, filename, read } = args
  const rows = await readPluginOwnedRows({ context, listName: listKey })
  return rows.some((row) => {
    const value = read(row)
    return (
      typeof value === 'object' &&
      value !== null &&
      'filename' in value &&
      value.filename === filename
    )
  })
}
