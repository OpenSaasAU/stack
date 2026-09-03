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
import { isOneToOneRelationship, isRelationshipField } from '../fields/index.js'
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

const DEFAULT_NAMESPACE = 'public'

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

/**
 * A declared `createdAt`/`updatedAt` field replaces the auto-timestamp
 * column, as the generator has always allowed.
 */
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

type NativeType = {
  type: string
  /** How many arguments the constructor takes, as an inclusive range. */
  arity: [number, number]
  /** The single argument is a fractional-seconds precision, 0–6. */
  precision?: true
}

/**
 * The Postgres constructors `db.nativeType` may name, keyed by their
 * lower-cased spelling, and the pack type each folds to. Every entry is one
 * the builder feed lowers to its own column descriptor.
 */
const NATIVE_TYPES: Record<string, NativeType> = {
  text: { type: 'text', arity: [0, 0] },
  varchar: { type: 'varchar', arity: [1, 1] },
  char: { type: 'char', arity: [1, 1] },
  uuid: { type: 'uuid', arity: [0, 0] },
  integer: { type: 'int', arity: [0, 0] },
  int: { type: 'int', arity: [0, 0] },
  smallint: { type: 'smallint', arity: [0, 0] },
  bigint: { type: 'bigint', arity: [0, 0] },
  decimal: { type: 'decimal', arity: [0, 2] },
  numeric: { type: 'decimal', arity: [0, 2] },
  doubleprecision: { type: 'float', arity: [0, 0] },
  real: { type: 'real', arity: [0, 0] },
  boolean: { type: 'boolean', arity: [0, 0] },
  date: { type: 'date', arity: [0, 0] },
  timestamp: { type: 'timestamp', arity: [0, 1], precision: true },
  timestamptz: { type: 'timestamptz', arity: [0, 1], precision: true },
  time: { type: 'time', arity: [0, 1], precision: true },
  json: { type: 'json', arity: [0, 0] },
  jsonb: { type: 'jsonb', arity: [0, 0] },
  bytea: { type: 'bytes', arity: [0, 0] },
}

function nativeTypeError(listKey: string, fieldKey: string, nativeType: string, detail: string) {
  return new Error(
    `List "${listKey}": fields.${fieldKey} sets db.nativeType "${nativeType}", ${detail}`,
  )
}

/**
 * Fold a `db.nativeType` override (`VarChar(255)`, `Date`, `Decimal(10, 2)`,
 * `Timestamptz(3)`) into the column's type descriptor. Only the constructors
 * in {@link NATIVE_TYPES} are recognised, each with its own argument count;
 * anything else is a generate-time error naming the field.
 */
function foldNativeType(
  listKey: string,
  fieldKey: string,
  type: ColumnTypeDescriptor,
  nativeType: string | undefined,
): ColumnTypeDescriptor {
  if (nativeType === undefined) return type
  const match = /^\s*([A-Za-z]+)\s*(?:\(\s*([^)]*)\))?\s*$/.exec(nativeType)
  const native = match ? NATIVE_TYPES[match[1].toLowerCase()] : undefined
  if (!match || native === undefined) {
    throw nativeTypeError(
      listKey,
      fieldKey,
      nativeType,
      `which is not a Postgres type the contract can carry. Supported: ${Object.keys(NATIVE_TYPES).join(', ')} (with their arguments).`,
    )
  }
  const args = (match[2] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const n = Number(part)
      if (!Number.isInteger(n)) {
        throw nativeTypeError(
          listKey,
          fieldKey,
          nativeType,
          `whose argument "${part}" is not an integer.`,
        )
      }
      return n
    })
  const [min, max] = native.arity
  if (args.length < min || args.length > max) {
    const expected =
      min === max ? `${min} argument${min === 1 ? '' : 's'}` : `between ${min} and ${max} arguments`
    throw nativeTypeError(
      listKey,
      fieldKey,
      nativeType,
      `but ${match[1]} takes ${expected}${min > 0 && args.length === 0 ? ` — write ${match[1]}(n)` : ''}.`,
    )
  }
  if (native.precision && args.length === 1 && (args[0] < 0 || args[0] > 6)) {
    throw nativeTypeError(
      listKey,
      fieldKey,
      nativeType,
      `but a fractional-seconds precision must be between 0 and 6.`,
    )
  }
  return pgType(native.type, args)
}

function toContractColumn(
  listKey: string,
  fieldKey: string,
  descriptor: ContractColumnDescriptor,
): ContractColumn {
  const { nativeType, ...rest } = descriptor
  return { ...rest, type: foldNativeType(listKey, fieldKey, descriptor.type, nativeType) }
}

function foreignKeyColumnName(fieldKey: string): string {
  return `${fieldKey}Id`
}

type FieldLevelIndex = {
  fieldKey: string
  isIndexed: true | 'unique'
  /**
   * The constraint is the relationship's default rather than a spelled-out
   * `isIndexed` — the to-one foreign key's index, or the unique constraint the
   * owning side of a one-to-one carries (ADR-0064).
   */
  implicit: boolean
  /** The other end of the one-to-one whose unique constraint this is. */
  oneToOneWith?: string
}

type ModelDraft = {
  model: ContractModel
  /** Column name → the field-level `isIndexed` that already indexes it. */
  fieldLevelIndexes: Map<string, FieldLevelIndex>
  /** Field key → the FK column it owns, for `db.indexes` resolution. */
  ownedForeignKeys: Map<string, string>
  multiColumnFields: Set<string>
  /** Contract member name → what claimed it, for the collision backstop. */
  members: Map<string, string>
}

function claimMember(listKey: string, draft: ModelDraft, name: string, origin: string): void {
  const existing = draft.members.get(name)
  if (existing !== undefined) {
    throw new Error(
      `List "${listKey}": ${origin} derives the contract member "${name}", which ${existing} already claims on the same model`,
    )
  }
  draft.members.set(name, origin)
}

/** A `from_<List>_<field>` back-relation and the list-only ref that synthesised it. */
type SyntheticRelation = { from: string; relation: ContractRelation }

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
  syntheticByTarget: Map<string, SyntheticRelation[]>,
): void {
  const from = `List "${listKey}": fields.${fieldKey}`
  requireList(config, descriptor.target, from)
  const targetList = config.lists[descriptor.target]
  const inverseKey = `${descriptor.target}.${descriptor.inverse.field}`

  if (descriptor.many && descriptor.inverse.synthetic) {
    throw new Error(
      `${from} is many: true with the list-only ref "${field.ref}" — an implicit many-to-many, which the ` +
        `contract cannot carry (ADR-0048). Author the junction as its own list.`,
    )
  }
  if (!descriptor.inverse.synthetic) {
    const inverseField = targetList.fields[descriptor.inverse.field]
    if (!isRelationshipField(inverseField)) {
      throw new Error(
        `${from} refs "${field.ref}", but "${inverseKey}" is not a relationship field`,
      )
    }
    if (inverseField.ref !== `${listKey}.${fieldKey}`) {
      throw new Error(
        `${from} refs "${field.ref}", but "${inverseKey}" refs "${inverseField.ref}" rather than ` +
          `"${listKey}.${fieldKey}" — the two ends of a relationship must name each other`,
      )
    }
    if (descriptor.many && inverseField.many) {
      throw new Error(
        `${from} and list "${descriptor.target}": fields.${descriptor.inverse.field} are both many: true — ` +
          `an implicit many-to-many, which the contract cannot carry (ADR-0048).`,
      )
    }
  }

  claimMember(listKey, draft, fieldKey, `fields.${fieldKey}`)

  const { foreignKey } = descriptor
  if (foreignKey) {
    const targetStrategy = resolveIdStrategy(targetList, config)
    const oneToOne = isOneToOneRelationship(fieldKey, field, config)
    claimMember(listKey, draft, foreignKey.name, `the foreign-key column of fields.${fieldKey}`)
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
      const explicit = field.isIndexed === 'unique' || (field.isIndexed === true && !oneToOne)
      draft.fieldLevelIndexes.set(foreignKey.name, {
        fieldKey,
        isIndexed: foreignKey.unique ? 'unique' : true,
        implicit: !explicit,
        ...(oneToOne ? { oneToOneWith: inverseKey } : {}),
      })
    }
    draft.model.relations.push({
      name: fieldKey,
      target: descriptor.target,
      kind: 'belongsTo',
      column: foreignKey.name,
      oneToOne,
      synthetic: false,
    })
    if (descriptor.inverse.synthetic) {
      const existing = syntheticByTarget.get(descriptor.target) ?? []
      existing.push({
        from: `${listKey}.${fieldKey}`,
        relation: {
          name: descriptor.inverse.field,
          target: listKey,
          kind: 'hasMany',
          column: foreignKey.name,
          oneToOne: false,
          synthetic: true,
        },
      })
      syntheticByTarget.set(descriptor.target, existing)
    }
    return
  }

  draft.model.relations.push({
    name: fieldKey,
    target: descriptor.target,
    kind: descriptor.many ? 'hasMany' : 'hasOne',
    column: foreignKeyColumnName(descriptor.inverse.field),
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
  if (isRelationshipField(field)) {
    if (field.many) {
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

/**
 * A single-field entry on a column a field-level constraint already covers:
 * a spelled-out `isIndexed` is a genuine duplicate and is refused; a
 * relationship's default index, or the one-to-one's implicit unique, yields
 * to the entry — which then names the constraint — except that a plain
 * index cannot stand in for the unique that makes a one-to-one.
 */
function adoptFieldLevelIndex(
  listKey: string,
  draft: ModelDraft,
  entry: string,
  column: string,
  collision: FieldLevelIndex,
  unique: boolean,
): void {
  if (!collision.implicit) {
    const value = collision.isIndexed === 'unique' ? `'unique'` : 'true'
    throw new Error(
      `${entry} on list "${listKey}" duplicates the constraint already produced by field "${collision.fieldKey}"'s isIndexed: ${value} — both would emit an index on "${column}"; remove one of them`,
    )
  }
  if (collision.isIndexed === 'unique' && !unique) {
    throw new Error(
      `${entry} on list "${listKey}" names field "${collision.fieldKey}", the owning side of the one-to-one with ` +
        `"${collision.oneToOneWith}", whose column "${column}" already carries the unique constraint that makes ` +
        `it one-to-one (ADR-0064); a further index on it is redundant. Set unique: true on the entry to name ` +
        `that constraint, or remove the entry`,
    )
  }
  const owned = draft.model.columns.find((candidate) => candidate.name === column)
  if (owned) {
    delete owned.unique
    delete owned.index
  }
  draft.fieldLevelIndexes.delete(column)
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
    const unique = index.unique === true
    if (columns.length === 1) {
      const collision = draft.fieldLevelIndexes.get(columns[0])
      if (collision) adoptFieldLevelIndex(listKey, draft, entry, columns[0], collision, unique)
    }
    return {
      columns,
      unique,
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

function collectNamespaces(config: OpenSaasConfig, models: ContractModel[]): string[] {
  const namespaces = new Set<string>(config.db.schemas ?? [])
  for (const model of models) {
    if (model.namespace !== undefined) namespaces.add(model.namespace)
  }
  namespaces.delete(DEFAULT_NAMESPACE)
  return [...namespaces]
}

/**
 * Derive the contract data a config describes (ADR-0057): one model per list
 * with its id by strategy, stored columns from each field builder's structured
 * descriptor, `temporal` auto-timestamps, foreign keys with the relationship's
 * referential actions, `db.indexes` resolved to columns, the relation graph
 * with foreign-key ownership (ADR-0064), synthetic back-relations for
 * list-only refs, the native enums, the namespaces beyond `public`, and the
 * declared extension packs.
 *
 * Expects a config that passed `validateDatabaseConfig` and
 * `validateRelations`; what it still throws on — naming the list and field —
 * is a backstop for a config that skipped them, plus the `db.nativeType` and
 * `db.indexes` resolution errors that are only decidable here.
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
  const drafts = new Map<string, ModelDraft>()
  const syntheticByTarget = new Map<string, SyntheticRelation[]>()

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const timestamps = resolveTimestamps(listConfig, config)
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
        timestamps,
      },
      fieldLevelIndexes: new Map(),
      ownedForeignKeys: new Map(),
      multiColumnFields: new Set(),
      members: new Map([['id', 'the id column']]),
    }
    if (timestamps.createdAt) draft.members.set('createdAt', 'the createdAt auto-timestamp')
    if (timestamps.updatedAt) draft.members.set('updatedAt', 'the updatedAt auto-timestamp')

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
          claimMember(listKey, draft, column.name, `fields.${fieldKey}`)
          draft.model.columns.push(toContractColumn(listKey, fieldKey, column))
          const isIndexed = readIsIndexed(field)
          if (isIndexed !== undefined) {
            draft.fieldLevelIndexes.set(column.name, { fieldKey, isIndexed, implicit: false })
          }
          break
        }
        case 'columns':
          draft.multiColumnFields.add(fieldKey)
          for (const column of descriptor.columns) {
            claimMember(listKey, draft, column.name, `fields.${fieldKey}`)
            draft.model.columns.push(toContractColumn(listKey, fieldKey, column))
          }
          break
        case 'relation':
          if (!isRelationshipField(field)) {
            throw new Error(
              `Field "${listKey}.${fieldKey}" (type "${field.type}") describes a relation but is not a relationship field`,
            )
          }
          deriveRelation(listKey, fieldKey, field, descriptor, config, draft, syntheticByTarget)
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
    for (const { from, relation } of relations) {
      claimMember(
        target,
        draft,
        relation.name,
        `the back-relation synthesised for the list-only ref on "${from}"`,
      )
      draft.model.relations.push(relation)
    }
  }

  const models = [...drafts.values()].map((draft) => draft.model)
  return {
    models,
    namespaces: collectNamespaces(config, models),
    enums: collectEnums(models),
    extensions,
  }
}
