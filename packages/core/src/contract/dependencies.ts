import type { ListConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import { isRelationshipField, shouldHaveForeignKey } from '../fields/index.js'
import { resolveListTimestamps } from './derive.js'
import type { ContractData, ContractModel } from './types.js'

/**
 * One computed field's declared dependency set (ADR-0051): one hop,
 * non-transitive, resolved at generation and emitted rather than walked on
 * every read.
 */
export interface FieldDependencySet {
  /**
   * Model field names the hook's `item` must carry — every `needs` entry that
   * names a stored field, plus the foreign-key column each declared relation
   * implies on the sides that own one.
   */
  columns: string[]
  /** Relationship field keys to fetch one hop deep. No computed field runs on the rows they return. */
  relations: string[]
}

/** One list's row in the dependency-set table. */
export interface ListDependencies {
  /**
   * The list's actual system fields — `id` always, and each auto-timestamp
   * the list carries. A list with `db.timestamps: false` and no declared
   * timestamp field lists only `id`.
   */
  systemFields: string[]
  /** Keyed by the field key of every field with a `resolveOutput` hook; a field that declares no `needs` has empty sets. */
  fields: Record<string, FieldDependencySet>
}

/**
 * The emitted `(list, field) → dependency set` table (ADR-0051). The engine
 * widens a read from this rather than walking `config.lists`, and the
 * generated types render each field's set a second time as the `Remainder`'s
 * `needs` — one computation, two renderings.
 */
export type DependencyTable = Record<string, ListDependencies>

/** The list and field names one emitted unique constraint covers. */
export interface UniqueConstraint {
  /** The list key the constraint is on. */
  list: string
  /** The OpenSaas field keys the constraint covers, in constraint-column order. */
  fields: string[]
}

/**
 * Every unique constraint the generator emits, keyed by the physical
 * constraint name PostgreSQL reports (ADR-0042). A unique violation resolves
 * to per-field messages by looking its constraint name up here, so no error
 * prose is ever parsed.
 */
export type ConstraintMap = Record<string, UniqueConstraint>

/** The two tables the generator emits into the bundle beside the four generated files. */
export interface GeneratedTables {
  dependencies: DependencyTable
  constraints: ConstraintMap
}

/** PostgreSQL's `NAMEDATALEN - 1`: an identifier longer than this is truncated on a character boundary. */
const MAX_IDENTIFIER_BYTES = 63

const encoder = new TextEncoder()

function truncateIdentifier(name: string): string {
  if (encoder.encode(name).length <= MAX_IDENTIFIER_BYTES) return name
  let truncated = ''
  let bytes = 0
  for (const character of name) {
    const width = encoder.encode(character).length
    if (bytes + width > MAX_IDENTIFIER_BYTES) break
    truncated += character
    bytes += width
  }
  return truncated
}

function foreignKeyColumnName(fieldKey: string): string {
  return `${fieldKey}Id`
}

/**
 * A relationship field's foreign-key column, or `undefined` where the other
 * side owns it. An unresolvable `ref` is `validateRelations`' finding, so it
 * counts as no column here rather than throwing out of the table.
 */
function ownedForeignKeyColumn(
  config: OpenSaasConfig,
  listKey: string,
  fieldKey: string,
  field: ListConfig<TypeInfo>['fields'][string],
): string | undefined {
  if (!isRelationshipField(field)) return undefined
  try {
    return shouldHaveForeignKey(listKey, fieldKey, field, config)
      ? foreignKeyColumnName(fieldKey)
      : undefined
  } catch {
    return undefined
  }
}

function systemFieldsOf(config: OpenSaasConfig, listConfig: ListConfig<TypeInfo>): string[] {
  const fields = listConfig.fields ?? {}
  const timestamps = resolveListTimestamps(listConfig, config.db)
  const names = ['id']
  if (timestamps.createdAt || Object.prototype.hasOwnProperty.call(fields, 'createdAt')) {
    names.push('createdAt')
  }
  if (timestamps.updatedAt || Object.prototype.hasOwnProperty.call(fields, 'updatedAt')) {
    names.push('updatedAt')
  }
  return names
}

/**
 * Resolve every computed field's `needs` into its one-hop dependency set, and
 * each list's actual system fields (ADR-0051).
 *
 * Reads the config, not the emitted contract — computing the set before
 * emission and reading it back would invert the dependency. It expects a
 * config that passed `validateNeedsDeclarations`; an entry that names nothing
 * on the list is dropped rather than thrown on, so a table can still be built
 * for a config whose refusals are being reported.
 */
export function deriveDependencyTable(config: OpenSaasConfig): DependencyTable {
  const table: DependencyTable = {}

  for (const listKey of Object.keys(config.lists).sort()) {
    const listConfig = config.lists[listKey]
    const fieldConfigs = listConfig?.fields ?? {}
    const fields: Record<string, FieldDependencySet> = {}

    for (const fieldKey of Object.keys(fieldConfigs).sort()) {
      const fieldConfig = fieldConfigs[fieldKey]
      if (!fieldConfig?.hooks?.resolveOutput) continue

      const columns = new Set<string>()
      const relations = new Set<string>()

      for (const name of fieldConfig.needs ?? []) {
        const dependency = fieldConfigs[name]
        if (dependency && isRelationshipField(dependency)) {
          relations.add(name)
          const column = ownedForeignKeyColumn(config, listKey, name, dependency)
          if (column) columns.add(column)
          continue
        }
        if (!dependency) continue
        columns.add(name)
      }

      fields[fieldKey] = {
        columns: [...columns].sort(),
        relations: [...relations].sort(),
      }
    }

    table[listKey] = {
      systemFields: systemFieldsOf(config, listConfig ?? { fields: {} }),
      fields,
    }
  }

  return table
}

/** Model field name → the OpenSaas field key it belongs to, for every stored column of one list. */
function columnOwners(
  config: OpenSaasConfig,
  listKey: string,
  listConfig: ListConfig<TypeInfo>,
): Map<string, string> {
  const owners = new Map<string, string>([
    ['id', 'id'],
    ['createdAt', 'createdAt'],
    ['updatedAt', 'updatedAt'],
  ])

  for (const [fieldKey, fieldConfig] of Object.entries(listConfig.fields ?? {})) {
    if (!fieldConfig || fieldConfig.virtual) continue
    if (isRelationshipField(fieldConfig)) {
      const column = ownedForeignKeyColumn(config, listKey, fieldKey, fieldConfig)
      if (column) owners.set(column, fieldKey)
      continue
    }
    if (fieldConfig.getColumnNames) {
      for (const column of fieldConfig.getColumnNames(fieldKey)) owners.set(column, fieldKey)
      continue
    }
    owners.set(fieldKey, fieldKey)
  }

  return owners
}

/** The physical column a model's contract column maps to (`db.map`), which is what a constraint name is built from. */
function physicalColumn(model: ContractModel, name: string): string {
  const column = model.columns.find((candidate) => candidate.name === name)
  return column?.map ?? name
}

/**
 * PostgreSQL's own default name for an unnamed unique constraint —
 * `<table>_<column…>_key`, truncated to `NAMEDATALEN - 1`. Prisma emits the
 * constraint without a name and PostgreSQL derives it, so this is the name
 * `SqlQueryError.constraint` reports.
 */
function defaultUniqueName(table: string, columns: string[]): string {
  return truncateIdentifier(`${table}_${columns.join('_')}_key`)
}

function claim(map: ConstraintMap, name: string, entry: UniqueConstraint, listKey: string): void {
  const existing = map[name]
  if (existing) {
    throw new Error(
      `The unique constraint "${name}" is emitted by both list "${existing.list}" (${existing.fields.join(', ')}) ` +
        `and list "${listKey}" (${entry.fields.join(', ')}), so a violation could not be resolved to one set of ` +
        `fields. Give one of them an explicit name with a db.indexes entry.`,
    )
  }
  map[name] = entry
}

/**
 * Map every unique constraint the generator emits to the OpenSaas field names
 * it covers (ADR-0042): each model's primary key, each column-level
 * `isIndexed: 'unique'`, the unique the owning column of a one-to-one carries
 * (ADR-0064), and every `db.indexes` entry with `unique: true` — under its
 * adopted `name` where it declares one.
 *
 * Known limits:
 * - A constraint managed by hand in the database is not here, and falls
 *   through to the generic unique-violation message.
 * - Two constraints whose derived names collide after PostgreSQL's
 *   63-byte truncation are a generation error naming both lists; the fix is
 *   an explicit `name` on one of the entries.
 */
export function deriveConstraintMap(config: OpenSaasConfig, contract: ContractData): ConstraintMap {
  const map: ConstraintMap = {}

  for (const model of contract.models) {
    const listConfig = config.lists[model.name]
    if (!listConfig) continue
    const owners = columnOwners(config, model.name, listConfig)
    const table = model.table ?? model.name
    const fieldsOf = (columns: string[]): string[] =>
      columns.map((column) => owners.get(column) ?? column)

    claim(
      map,
      truncateIdentifier(`${table}_pkey`),
      { list: model.name, fields: ['id'] },
      model.name,
    )

    for (const column of model.columns) {
      if (!column.unique) continue
      claim(
        map,
        defaultUniqueName(table, [physicalColumn(model, column.name)]),
        { list: model.name, fields: fieldsOf([column.name]) },
        model.name,
      )
    }

    for (const index of model.indexes) {
      if (!index.unique) continue
      const name =
        index.name ??
        defaultUniqueName(
          table,
          index.columns.map((column) => physicalColumn(model, column)),
        )
      claim(map, name, { list: model.name, fields: fieldsOf(index.columns) }, model.name)
    }
  }

  return map
}

/** Both emitted tables, from the one pass the generator already runs over the config. */
export function deriveGeneratedTables(
  config: OpenSaasConfig,
  contract: ContractData,
): GeneratedTables {
  return {
    dependencies: deriveDependencyTable(config),
    constraints: deriveConstraintMap(config, contract),
  }
}
