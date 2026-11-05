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

function filenamesOf(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return []
  const names: string[] = []
  if ('filename' in value && typeof value.filename === 'string') names.push(value.filename)
  if ('transformations' in value && typeof value.transformations === 'object') {
    for (const variant of Object.values(value.transformations ?? {})) {
      if (typeof variant === 'object' && variant !== null && 'filename' in variant) {
        if (typeof variant.filename === 'string') names.push(variant.filename)
      }
    }
  }
  return names
}

/**
 * Whether any row of the list, whatever the session can see, stores `filename`,
 * as the original or as a transformation variant, in this field. Reads through the engine's own handle: the answer must not
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
    if (excludeId !== undefined && String(row.id) === String(excludeId)) return false
    const value = field.assembleColumns ? field.assembleColumns(fieldKey, row) : row[fieldKey]
    return filenamesOf(value).includes(filename)
  })
}
