import type { ListConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import type { ConfigRefusal } from './config-refusal.js'

function refuseIndexSort(listKey: string, listConfig: ListConfig<TypeInfo>): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = []
  const indexes = listConfig.db?.indexes ?? []

  indexes.forEach((index, i) => {
    for (const fieldRef of index.fields) {
      if (typeof fieldRef === 'string' || !('sort' in fieldRef) || fieldRef.sort === undefined) {
        continue
      }
      refusals.push({
        listKey,
        entry: `db.indexes[${i}]`,
        reason: 'index-sort',
        message:
          `List "${listKey}": db.indexes[${i}] gives field "${fieldRef.field}" a sort direction, ` +
          `which an index column cannot carry (ADR-0040). Remove "sort" from that entry — the index keeps its column order.`,
      })
    }
  })

  return refusals
}

function refuseIdFieldOnSingleton(
  listKey: string,
  listConfig: ListConfig<TypeInfo>,
): ConfigRefusal[] {
  const idField = listConfig.db?.idField
  if (!listConfig.isSingleton || idField === undefined) return []

  return [
    {
      listKey,
      entry: 'db.idField',
      reason: 'id-field-on-singleton',
      message:
        `List "${listKey}": db.idField is "${idField}" on a singleton list, but a singleton's id is derived ` +
        `from isSingleton (ADR-0048). Remove db.idField from "${listKey}".`,
    },
  ]
}

function refuseDuplicateExtensionPacks(config: OpenSaasConfig): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = []
  const firstByName = new Map<string, { index: number; from: string }>()

  const extensions = config.db?.extensions ?? []
  extensions.forEach(({ name, from }, i) => {
    const first = firstByName.get(name)
    if (!first) {
      firstByName.set(name, { index: i, from })
      return
    }
    if (first.from === from) return
    refusals.push({
      entry: `db.extensions[${i}]`,
      reason: 'duplicate-extension-pack',
      message:
        `db.extensions[${i}] declares pack "${name}" from "${from}", but db.extensions[${first.index}] already ` +
        `declares "${name}" from "${first.from}". Two packs cannot share a name — rename one of them, or point ` +
        `both declarations at the same package.`,
    })
  })

  return refusals
}

/**
 * Refuse the database-level declarations the Prisma 8 contract cannot carry:
 * a `sort` direction on a `db.indexes` field reference (ADR-0040),
 * `db.idField` on a singleton list (ADR-0048), and the same extension pack
 * name declared from two packages (ADR-0049). Each refusal names the list
 * (when there is one), the entry and the fix.
 *
 * `sort` is absent from {@link ListIndexFieldRef}'s type; this catches the
 * runtime object that still carries one.
 */
export function validateDatabaseConfig(config: OpenSaasConfig): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = [...refuseDuplicateExtensionPacks(config)]

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    refusals.push(...refuseIndexSort(listKey, listConfig))
    refusals.push(...refuseIdFieldOnSingleton(listKey, listConfig))
  }

  return refusals
}
