import type { DatabaseConfig, ListConfig } from '@opensaas/stack-core'

/** The subset of a field config `computeDefaultColumns` needs — satisfied by both `FieldConfig` (server) and `SerializableFieldConfig` (client), since both carry `ui` intact. */
export interface DefaultColumnFieldLike {
  ui?: {
    listView?: {
      defaultColumn?: boolean
    }
  }
}

/** Whether a field belongs in a list/related-list table's DEFAULT column set (issue #1018) — `field.ui.listView.defaultColumn`, defaulting to `true`. Does not affect a field named explicitly via `initialColumns`/`itemView.columns`, which always wins over this default. */
export function isDefaultColumnField(field: DefaultColumnFieldLike | undefined): boolean {
  return field?.ui?.listView?.defaultColumn !== false
}

/**
 * The default column set for a fields map, in declaration order — every
 * field whose {@link isDefaultColumnField} holds. This is the single
 * curation rule shared by the server-side item-view layout helper
 * (`deriveItemView.ts`, for a related list's default table columns) and the
 * client-side list-view fallback (`ListViewClient`/`ListTable`, when no
 * explicit `columns` is supplied) — both curate off the same declared flag
 * instead of independently matching field names or types.
 */
export function computeDefaultColumns<T extends DefaultColumnFieldLike>(
  fields: Record<string, T>,
): string[] {
  return Object.keys(fields).filter((key) => isDefaultColumnField(fields[key]))
}

/**
 * Marks a list's `createdAt`/`updatedAt` fields as excluded from default
 * columns when they are this list's structural, system-managed timestamp
 * columns — identified by the list's own timestamp configuration
 * (`db.timestamps`, per-list or global), not by the field names alone. A
 * field's own explicit `ui.listView.defaultColumn` always wins over this.
 *
 * Only meaningful server-side, where the list's `db` config is available;
 * the client fallback never calls this and instead reads whatever flag
 * already reached it on the field (see `computeDefaultColumns`).
 */
export function withStructuralTimestampDefaults<T extends DefaultColumnFieldLike>(
  fields: Record<string, T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
  listConfig: Pick<ListConfig<any>, 'db'>,
  dbConfig: DatabaseConfig | undefined,
): Record<string, T> {
  const timestampsEnabled = listConfig.db?.timestamps ?? dbConfig?.timestamps ?? false
  if (!timestampsEnabled) return fields

  let result = fields
  for (const name of ['createdAt', 'updatedAt']) {
    const field = result[name]
    if (!field || field.ui?.listView?.defaultColumn !== undefined) continue
    if (result === fields) result = { ...fields }
    result[name] = {
      ...field,
      ui: { ...field.ui, listView: { ...field.ui?.listView, defaultColumn: false } },
    }
  }
  return result
}
