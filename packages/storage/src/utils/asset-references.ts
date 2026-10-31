import { withOrigin } from '@opensaas/stack-core/origin'
import type { AccessContext } from '@opensaas/stack-core'

interface ReferenceField {
  assembleColumns?: (fieldName: string, row: Record<string, unknown>) => unknown
  getColumnNames?: (fieldName: string) => string[]
}

interface RowReader {
  select(...fields: string[]): { all(): PromiseLike<Record<string, unknown>[]> }
}

function isRowReader(value: unknown): value is RowReader {
  return typeof value === 'object' && value !== null && 'select' in value
}

function filenameOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('filename' in value)) return undefined
  return typeof value.filename === 'string' ? value.filename : undefined
}

/**
 * Whether any row of the list, whatever the session can see, stores `filename`
 * in this field. Reads through the engine's own handle: the answer must not
 * depend on access rules, since a row the session cannot read still owns its file.
 */
export async function isAssetReferenced(
  context: AccessContext,
  listKey: string,
  fieldKey: string,
  field: ReferenceField,
  filename: string,
  excludeId?: unknown,
): Promise<boolean> {
  const collection = context.ormHandle[listKey]
  if (!isRowReader(collection)) {
    throw new Error(`Cannot check references to '${filename}': no ORM model for list '${listKey}'`)
  }
  const columns = field.getColumnNames ? field.getColumnNames(fieldKey) : [fieldKey]
  const rows = await withOrigin('engine', async () => collection.select('id', ...columns).all())
  return rows.some((row) => {
    if (excludeId !== undefined && row.id === excludeId) return false
    const value = field.assembleColumns ? field.assembleColumns(fieldKey, row) : row[fieldKey]
    return filenameOf(value) === filename
  })
}
