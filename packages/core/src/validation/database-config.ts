import type { ListConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import type { ConfigRefusal } from './config-refusal.js'
import { validateDefaultValues } from './default-value.js'
import { validateExtensionPacks } from './extension-packs.js'
import { validateFieldNames } from './field-names.js'

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

const ID_STRATEGIES = ['uuid7', 'cuid2', 'int autoincrement']

function describeIdField(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : JSON.stringify(value)
}

function refuseUnknownIdField(entry: string, value: unknown, listKey?: string): ConfigRefusal[] {
  if (value === undefined || (typeof value === 'string' && ID_STRATEGIES.includes(value))) return []
  const subject = listKey === undefined ? 'db.idField' : `List "${listKey}": db.idField`
  const composite =
    typeof value === 'object' && value !== null && 'fields' in value
      ? ' Composite primary keys are out of scope (ADR-0048); declare a surrogate id and a unique index instead.'
      : ''
  return [
    {
      ...(listKey === undefined ? {} : { listKey }),
      entry,
      reason: 'unknown-id-field',
      message:
        `${subject} is ${describeIdField(value)}, but it must be one of 'uuid7' | 'cuid2' | 'int autoincrement' ` +
        `(ADR-0048).${composite}`,
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
 * `db.idField` on a singleton list or outside the three id strategies (ADR-0048), the same extension pack
 * name declared from two packages, a field name the derivation reserves or
 * that collides with a derived column or relation ({@link validateFieldNames}),
 * a field that cannot describe its contract column, a field typed by a
 * pack `db.extensions` does not declare (ADR-0049), and an explicit
 * `defaultValue` the field's own create validation would reject
 * ({@link validateDefaultValues}, ADR-0052). Each refusal names the
 * list (when there is one), the entry and the fix.
 *
 * `sort` is absent from {@link ListIndexFieldRef}'s type; this catches the
 * runtime object that still carries one.
 */
export function validateDatabaseConfig(config: OpenSaasConfig): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = [
    ...refuseDuplicateExtensionPacks(config),
    ...refuseUnknownIdField('db.idField', config.db?.idField),
  ]

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    refusals.push(...refuseIndexSort(listKey, listConfig))
    refusals.push(...refuseIdFieldOnSingleton(listKey, listConfig))
    if (!listConfig.isSingleton) {
      refusals.push(...refuseUnknownIdField('db.idField', listConfig.db?.idField, listKey))
    }
  }

  refusals.push(...validateFieldNames(config))
  refusals.push(...validateExtensionPacks(config))
  refusals.push(...validateDefaultValues(config))

  return refusals
}
