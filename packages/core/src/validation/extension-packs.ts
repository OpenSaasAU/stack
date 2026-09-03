import type {
  ColumnTypeDescriptor,
  ContractFieldDescriptor,
  OpenSaasConfig,
} from '../config/types.js'
import type { ConfigRefusal } from './config-refusal.js'

export function undeclaredExtensionPackMessage(
  listKey: string,
  fieldKey: string,
  type: ColumnTypeDescriptor,
): string {
  return (
    `List "${listKey}": fields.${fieldKey} is typed "${type.type}" from extension pack "${type.pack}", ` +
    `which db.extensions does not declare (ADR-0049). Add { name: '${type.pack}', from: '<the pack's package>' } ` +
    `to db.extensions, or have the plugin that owns the field declare it through addExtension.`
  )
}

/**
 * Refuse a stored field whose column type comes from an extension pack that
 * `db.extensions` does not declare — the config must state its own
 * dependencies (ADR-0049). Core's own scalars (pack `pg`) need no declaration.
 * Relationship and virtual fields contribute no typed column and are skipped.
 */
export function validateExtensionPacks(config: OpenSaasConfig): ConfigRefusal[] {
  const declared = new Set((config.db.extensions ?? []).map((extension) => extension.name))
  const refusals: ConfigRefusal[] = []

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      if (field.virtual || field.type === 'relationship' || !field.getContractField) continue
      let descriptor: ContractFieldDescriptor
      try {
        descriptor = field.getContractField(fieldKey, listKey, config)
      } catch (error) {
        refusals.push({
          listKey,
          entry: `fields.${fieldKey}`,
          reason: 'field-descriptor-error',
          message:
            `List "${listKey}": fields.${fieldKey} cannot describe its contract column — ` +
            (error instanceof Error ? error.message : String(error)),
        })
        continue
      }
      const columns =
        descriptor.kind === 'column'
          ? [descriptor]
          : descriptor.kind === 'columns'
            ? descriptor.columns
            : []
      for (const column of columns) {
        if (column.type.pack === 'pg' || declared.has(column.type.pack)) continue
        refusals.push({
          listKey,
          entry: `fields.${fieldKey}`,
          reason: 'undeclared-extension-pack',
          message: undeclaredExtensionPackMessage(listKey, fieldKey, column.type),
        })
        break
      }
    }
  }

  return refusals
}
