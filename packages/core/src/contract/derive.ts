import type {
  ColumnTypeDescriptor,
  ContractColumnDescriptor,
  ContractFieldDescriptor,
  ContractRelationDescriptor,
  ExtensionDescriptor,
  FieldConfig,
  ListConfig,
  ListIndex,
  OpenSaasConfig,
  RelationshipField,
  TypeInfo,
} from '../config/types.js'
import { isOneToOneRelationship } from '../fields/index.js'
import { undeclaredExtensionPackMessage } from '../validation/extension-packs.js'
import type {
  ContractColumn,
  ContractData,
  ContractEnum,
  ContractIdColumn,
  ContractIdStrategy,
  ContractIndex,
  ContractModel,
  ContractRelation,
  ContractTimestamps,
} from './types.js'

function pgType(type: string, args?: number[]): ColumnTypeDescriptor {
  return args && args.length > 0 ? { pack: 'pg', type, args } : { pack: 'pg', type }
}

function idColumn(strategy: ContractIdStrategy): ContractIdColumn {
  switch (strategy) {
    case 'uuid7':
      return { strategy, type: pgType('uuid') }
    case 'cuid2':
      return { strategy, type: pgType('char', [24]) }
    case 'int autoincrement':
    case 'singleton':
      return { strategy, type: pgType('int') }
  }
}

function resolveIdStrategy(
  listConfig: ListConfig<TypeInfo>,
  config: OpenSaasConfig,
): ContractIdStrategy {
  if (listConfig.isSingleton) return 'singleton'
  return listConfig.db?.idField ?? config.db.idField ?? 'uuid7'
}

function resolveTimestamps(
  listConfig: ListConfig<TypeInfo>,
  config: OpenSaasConfig,
): ContractTimestamps {
  const enabled = listConfig.db?.timestamps ?? config.db.timestamps ?? false
  if (!enabled) return { createdAt: false, updatedAt: false }
  return {
    createdAt: !Object.prototype.hasOwnProperty.call(listConfig.fields, 'createdAt'),
    updatedAt: !Object.prototype.hasOwnProperty.call(listConfig.fields, 'updatedAt'),
  }
}

const NATIVE_TYPES: Record<string, string> = {
  text: 'text',
  varchar: 'varchar',
  char: 'char',
  uuid: 'uuid',
  integer: 'int',
  int: 'int',
  smallint: 'smallint',
  bigint: 'bigint',
  decimal: 'decimal',
  numeric: 'decimal',
  doubleprecision: 'float',
  real: 'float',
  boolean: 'boolean',
  date: 'date',
  timestamp: 'timestamp',
  timestamptz: 'timestamptz',
  json: 'json',
  jsonb: 'jsonb',
  bytea: 'bytes',
}

/**
 * Fold a `db.nativeType` override (`VarChar(255)`, `Date`, `Decimal(18, 4)`)
 * into the column's type descriptor. Only the Postgres pack's constructors
 * are recognised; anything else is a generate-time error naming the field.
 */
function foldNativeType(
  listKey: string,
  fieldKey: string,
  type: ColumnTypeDescriptor,
  nativeType: string | undefined,
): ColumnTypeDescriptor {
  if (nativeType === undefined) return type
  const match = /^\s*([A-Za-z]+)\s*(?:\(\s*([^)]*)\))?\s*$/.exec(nativeType)
  const mapped = match ? NATIVE_TYPES[match[1].toLowerCase()] : undefined
  if (!match || mapped === undefined) {
    throw new Error(
      `List "${listKey}": fields.${fieldKey} sets db.nativeType "${nativeType}", which is not a Postgres ` +
        `type the contract can carry. Supported: ${Object.keys(NATIVE_TYPES).join(', ')} (with their arguments).`,
    )
  }
  const args = (match[2] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const n = Number(part)
      if (!Number.isInteger(n)) {
        throw new Error(
          `List "${listKey}": fields.${fieldKey} sets db.nativeType "${nativeType}", whose argument "${part}" is not an integer.`,
        )
      }
      return n
    })
  return pgType(mapped, args)
}

function toContractColumn(
  listKey: string,
  fieldKey: string,
  descriptor: ContractColumnDescriptor,
  declaredPacks: ReadonlySet<string>,
): ContractColumn {
  const { nativeType, ...rest } = descriptor
  const type = foldNativeType(listKey, fieldKey, descriptor.type, nativeType)
  if (type.pack !== 'pg' && !declaredPacks.has(type.pack)) {
    throw new Error(undeclaredExtensionPackMessage(listKey, fieldKey, type))
  }
  return { ...rest, type }
}

function foreignKeyColumnName(fieldKey: string): string {
  return `${fieldKey}Id`
}

type FieldLevelIndex = { fieldKey: string; isIndexed: true | 'unique' }

type ModelDraft = {
  model: ContractModel
  /** Column name → the field-level `isIndexed` that already indexes it. */
  fieldLevelIndexes: Map<string, FieldLevelIndex>
  /** Field key → the FK column it owns, for `db.indexes` resolution. */
  ownedForeignKeys: Map<string, string>
  multiColumnFields: Set<string>
}

function readIsIndexed(field: FieldConfig): true | 'unique' | undefined {
  const value: unknown = 'isIndexed' in field ? field.isIndexed : undefined
  return value === true || value === 'unique' ? value : undefined
}

function requireList(config: OpenSaasConfig, listKey: string, from: string): void {
  if (!config.lists[listKey]) {
    throw new Error(`${from} references list "${listKey}", which is not in the config`)
  }
}

function deriveRelation(
  listKey: string,
  fieldKey: string,
  field: RelationshipField,
  descriptor: ContractRelationDescriptor,
  config: OpenSaasConfig,
  draft: ModelDraft,
  syntheticByTarget: Map<string, ContractRelation[]>,
): void {
  requireList(config, descriptor.target, `List "${listKey}": fields.${fieldKey}`)
  const targetList = config.lists[descriptor.target]
  const inverseField = targetList.fields[descriptor.inverse.field]
  if (
    descriptor.many &&
    !descriptor.inverse.synthetic &&
    inverseField?.type === 'relationship' &&
    (inverseField as RelationshipField).many
  ) {
    throw new Error(
      `List "${listKey}": fields.${fieldKey} and list "${descriptor.target}": fields.${descriptor.inverse.field} ` +
        `are both many: true — an implicit many-to-many, which the contract cannot carry (ADR-0048).`,
    )
  }

  const { foreignKey } = descriptor
  if (foreignKey) {
    const targetStrategy = resolveIdStrategy(targetList, config)
    draft.model.columns.push({
      name: foreignKey.name,
      type: idColumn(targetStrategy).type,
      nullable: foreignKey.nullable,
      ...(foreignKey.map !== undefined && foreignKey.map !== foreignKey.name
        ? { map: foreignKey.map }
        : {}),
      ...(foreignKey.unique ? { unique: true } : {}),
      ...(foreignKey.index && !foreignKey.unique ? { index: true } : {}),
    })
    draft.model.foreignKeys.push({
      column: foreignKey.name,
      references: { model: descriptor.target, column: 'id' },
      ...(field.db?.onDelete !== undefined ? { onDelete: field.db.onDelete } : {}),
      ...(field.db?.onUpdate !== undefined ? { onUpdate: field.db.onUpdate } : {}),
    })
    draft.ownedForeignKeys.set(fieldKey, foreignKey.name)
    if (foreignKey.unique || foreignKey.index) {
      draft.fieldLevelIndexes.set(foreignKey.name, {
        fieldKey,
        isIndexed: foreignKey.unique ? 'unique' : true,
      })
    }
    draft.model.relations.push({
      name: fieldKey,
      target: descriptor.target,
      kind: 'belongsTo',
      column: foreignKey.name,
      oneToOne: isOneToOneRelationship(fieldKey, field, config),
      synthetic: false,
    })
    if (descriptor.inverse.synthetic) {
      const existing = syntheticByTarget.get(descriptor.target) ?? []
      existing.push({
        name: descriptor.inverse.field,
        target: listKey,
        kind: 'hasMany',
        column: foreignKey.name,
        oneToOne: false,
        synthetic: true,
      })
      syntheticByTarget.set(descriptor.target, existing)
    }
    return
  }

  if (inverseField?.type !== 'relationship') {
    throw new Error(
      `List "${listKey}": fields.${fieldKey} refs "${field.ref}", but "${descriptor.target}.${descriptor.inverse.field}" is not a relationship field`,
    )
  }
  const column = foreignKeyColumnName(descriptor.inverse.field)
  draft.model.relations.push({
    name: fieldKey,
    target: descriptor.target,
    kind: descriptor.many ? 'hasMany' : 'hasOne',
    column,
    oneToOne: !descriptor.many,
    synthetic: false,
  })
}

function resolveIndexColumn(
  listKey: string,
  listConfig: ListConfig<TypeInfo>,
  draft: ModelDraft,
  entry: string,
  fieldRef: ListIndex['fields'][number],
): string {
  const fieldKey = typeof fieldRef === 'string' ? fieldRef : fieldRef.field
  const field = listConfig.fields[fieldKey]
  if (!field) {
    if (
      (fieldKey === 'createdAt' && draft.model.timestamps.createdAt) ||
      (fieldKey === 'updatedAt' && draft.model.timestamps.updatedAt)
    ) {
      return fieldKey
    }
    throw new Error(`${entry} on list "${listKey}" references unknown field "${fieldKey}"`)
  }
  if (field.virtual) {
    throw new Error(
      `${entry} on list "${listKey}" references virtual field "${fieldKey}", which has no database column`,
    )
  }
  if (field.type === 'relationship') {
    if ((field as RelationshipField).many) {
      throw new Error(
        `${entry} on list "${listKey}" references to-many relationship field "${fieldKey}", which has no single database column`,
      )
    }
    const column = draft.ownedForeignKeys.get(fieldKey)
    if (!column) {
      throw new Error(
        `${entry} on list "${listKey}" references relationship field "${fieldKey}", which does not own a foreign key column on this model (the other side of the relationship owns it)`,
      )
    }
    return column
  }
  if (draft.multiColumnFields.has(fieldKey)) {
    throw new Error(
      `${entry} on list "${listKey}" references field "${fieldKey}", which maps to more than one database column and cannot be used in a model-level index`,
    )
  }
  return fieldKey
}

function deriveIndexes(
  listKey: string,
  listConfig: ListConfig<TypeInfo>,
  draft: ModelDraft,
): ContractIndex[] {
  const indexes = listConfig.db?.indexes ?? []
  return indexes.map((index, i) => {
    const entry = `Model-level index db.indexes[${i}]`
    if (index.fields.length === 0) {
      throw new Error(
        `${entry} on list "${listKey}" has an empty "fields" array — an index/constraint must name at least one field`,
      )
    }
    const columns = index.fields.map((fieldRef) =>
      resolveIndexColumn(listKey, listConfig, draft, entry, fieldRef),
    )
    if (columns.length === 1) {
      const collision = draft.fieldLevelIndexes.get(columns[0])
      if (collision) {
        const value = collision.isIndexed === 'unique' ? `'unique'` : 'true'
        throw new Error(
          `${entry} on list "${listKey}" duplicates the constraint already produced by field "${collision.fieldKey}"'s isIndexed: ${value} — both would emit an index on "${columns[0]}"; remove one of them`,
        )
      }
    }
    return {
      columns,
      unique: index.unique === true,
      ...(index.name !== undefined ? { name: index.name } : {}),
    }
  })
}

function collectEnums(models: ContractModel[]): ContractEnum[] {
  const byName = new Map<string, ContractEnum>()
  for (const model of models) {
    for (const column of model.columns) {
      if (!column.enum) continue
      const existing = byName.get(column.enum.name)
      if (!existing) {
        byName.set(column.enum.name, { name: column.enum.name, values: [...column.enum.values] })
        continue
      }
      if (
        existing.values.length !== column.enum.values.length ||
        existing.values.some((value, i) => value !== column.enum?.values[i])
      ) {
        throw new Error(
          `Enum "${column.enum.name}" is declared with different values by more than one field (model "${model.name}", column "${column.name}"). ` +
            `Give each distinct value set its own db.enumName.`,
        )
      }
    }
  }
  return [...byName.values()]
}

function dedupeExtensions(extensions: ExtensionDescriptor[]): ExtensionDescriptor[] {
  const seen = new Map<string, ExtensionDescriptor>()
  for (const extension of extensions) {
    if (!seen.has(extension.name)) seen.set(extension.name, { ...extension })
  }
  return [...seen.values()]
}

/**
 * Derive the contract data a config describes (ADR-0057): one model per list
 * with its id by strategy, stored columns from each field builder's structured
 * descriptor, `temporal` auto-timestamps, foreign keys with the relationship's
 * referential actions, `db.indexes` resolved to columns, the relation graph
 * with foreign-key ownership (ADR-0064), synthetic back-relations for
 * list-only refs, the native enums, and the declared extension packs.
 *
 * Throws a generate-time error naming the list and field for anything the
 * contract cannot carry that the config refusals do not already catch: a
 * field without `getContractField`, an unknown target list, a `db.nativeType`
 * outside the Postgres pack, a field typed by an undeclared pack, an implicit
 * many-to-many, a `db.indexes` entry that resolves to no single column, or
 * one enum name with two value sets.
 *
 * @example
 * ```typescript
 * import { deriveContract } from '@opensaas/stack-core'
 * const data = deriveContract(config)
 * data.models.find((m) => m.name === 'Post')?.relations
 * // [{ name: 'author', target: 'User', kind: 'belongsTo', column: 'authorId', oneToOne: false, synthetic: false }]
 * ```
 *
 * Known limits:
 * - Composite primary keys and a relationship at a composite-keyed list are
 *   out of scope (ADR-0048) and refused before derivation.
 * - `db.nativeType` is folded only for the Postgres pack's own constructors;
 *   an extension type's native-type override is not supported.
 * - `keystoneCompat`'s implicit `""` text default is not carried.
 */
export function deriveContract(config: OpenSaasConfig): ContractData {
  const extensions = dedupeExtensions(config.db.extensions ?? [])
  const declaredPacks = new Set(extensions.map((extension) => extension.name))
  const drafts = new Map<string, ModelDraft>()
  const syntheticByTarget = new Map<string, ContractRelation[]>()

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const draft: ModelDraft = {
      model: {
        name: listKey,
        ...(listConfig.db?.map !== undefined ? { table: listConfig.db.map } : {}),
        ...(listConfig.db?.schema !== undefined ? { namespace: listConfig.db.schema } : {}),
        singleton: listConfig.isSingleton !== undefined && listConfig.isSingleton !== false,
        id: idColumn(resolveIdStrategy(listConfig, config)),
        columns: [],
        foreignKeys: [],
        indexes: [],
        relations: [],
        timestamps: resolveTimestamps(listConfig, config),
      },
      fieldLevelIndexes: new Map(),
      ownedForeignKeys: new Map(),
      multiColumnFields: new Set(),
    }

    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      if (field.virtual) continue
      if (!field.getContractField) {
        throw new Error(
          `Field "${listKey}.${fieldKey}" (type "${field.type}") does not implement getContractField, so its contract contribution is unknown`,
        )
      }
      const descriptor: ContractFieldDescriptor = field.getContractField(fieldKey, listKey, config)
      switch (descriptor.kind) {
        case 'computed':
          break
        case 'column': {
          const { kind: _kind, ...column } = descriptor
          draft.model.columns.push(toContractColumn(listKey, fieldKey, column, declaredPacks))
          const isIndexed = readIsIndexed(field)
          if (isIndexed !== undefined) {
            draft.fieldLevelIndexes.set(column.name, { fieldKey, isIndexed })
          }
          break
        }
        case 'columns':
          draft.multiColumnFields.add(fieldKey)
          for (const column of descriptor.columns) {
            draft.model.columns.push(toContractColumn(listKey, fieldKey, column, declaredPacks))
          }
          break
        case 'relation':
          deriveRelation(
            listKey,
            fieldKey,
            field as RelationshipField,
            descriptor,
            config,
            draft,
            syntheticByTarget,
          )
          break
      }
    }

    draft.model.indexes = deriveIndexes(listKey, listConfig, draft)
    drafts.set(listKey, draft)
  }

  for (const [target, relations] of syntheticByTarget) {
    const draft = drafts.get(target)
    if (!draft) {
      throw new Error(
        `Synthetic back-relation targets list "${target}", which is not in the config`,
      )
    }
    draft.model.relations.push(...relations)
  }

  const models = [...drafts.values()].map((draft) => draft.model)
  return { models, enums: collectEnums(models), extensions }
}
