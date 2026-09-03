import { defineContract, nativeEnum, pg } from '@prisma/orm-postgres/contract-builder'
import type { NativeEnumHandle, ScalarFieldBuilder } from '@prisma/orm-postgres/contract-builder'
import {
  charColumn,
  dateStringColumn,
  int2Column,
  numericColumn,
  timestampStringColumn,
  timestamptzStringColumn,
  varcharColumn,
} from '@prisma/orm-postgres/adapter/column-types'
import type {
  ColumnTypeDescriptor as PrismaColumnType,
  ExtensionPackRef,
} from '@prisma/orm-postgres/components'
import type { Contract } from '@prisma/orm-postgres/contract/types'
import type { SqlStorage } from '@prisma/orm-postgres/family-contract/types'
import type { ColumnTypeDescriptor, ContractLiteral } from '../config/types.js'
import type { EmittedContract } from './relation-graph.js'
import type { ContractColumn, ContractData, ContractIdColumn, ContractModel } from './types.js'

/** A built Prisma 8 contract — what `postgres({ contract })` and the control client take. */
export type PrismaContract = Contract<SqlStorage>

/**
 * The extension packs a contract declares, keyed by pack name — each value
 * is the default export of the pack's `/pack` subpath
 * (`import pgvector from '@prisma/orm-extension-pgvector/pack'`).
 */
export type PrismaContractPacks = Record<string, ExtensionPackRef<'sql', string>>

export type BuildPrismaContractOptions = {
  /**
   * The loaded pack for every entry in the data's `extensions`. Core cannot
   * import a pack by package name on the caller's behalf; the caller resolves
   * each `from` and passes the value here.
   */
  packs?: PrismaContractPacks
}

type AuthoringHelpers = Parameters<
  Parameters<
    typeof defineContract<Record<never, never>, Record<never, never>, PrismaContractPacks>
  >[1]
>[0]
type FieldHelpers = AuthoringHelpers['field']
type Fields = Record<string, ScalarFieldBuilder>
type RelationBuilder =
  | ReturnType<AuthoringHelpers['rel']['belongsTo']>
  | ReturnType<AuthoringHelpers['rel']['hasOne']>
  | ReturnType<AuthoringHelpers['rel']['hasMany']>
type Relations = Record<string, RelationBuilder>

function firstNumber(args: ContractLiteral[] | undefined, index: number): number | undefined {
  const value = args?.[index]
  return typeof value === 'number' ? value : undefined
}

function isColumnType(value: unknown): value is PrismaColumnType {
  return (
    typeof value === 'object' &&
    value !== null &&
    'codecId' in value &&
    typeof value.codecId === 'string' &&
    'nativeType' in value &&
    typeof value.nativeType === 'string'
  )
}

/**
 * Resolve `type.<pack>.<type>(...args)` off the authoring helpers for an
 * extension-typed column. The helpers are typed by the packs the contract
 * was scaffolded with, which a data-driven build cannot name statically, so
 * the lookup narrows structurally.
 */
function extensionColumnType(
  helpers: AuthoringHelpers,
  model: string,
  column: ContractColumn,
): PrismaColumnType {
  const namespace: unknown = helpers.type
  const pack: unknown =
    typeof namespace === 'object' && namespace !== null && column.type.pack in namespace
      ? Reflect.get(namespace, column.type.pack)
      : undefined
  const constructor: unknown =
    typeof pack === 'object' && pack !== null && column.type.type in pack
      ? Reflect.get(pack, column.type.type)
      : undefined
  if (typeof constructor !== 'function') {
    throw new Error(
      `Model "${model}", column "${column.name}": extension pack "${column.type.pack}" has no type constructor "${column.type.type}"`,
    )
  }
  const built: unknown = constructor(...(column.type.args ?? []))
  if (!isColumnType(built)) {
    throw new Error(
      `Model "${model}", column "${column.name}": "${column.type.pack}.${column.type.type}" did not return a column type`,
    )
  }
  return built
}

function pgColumn(
  field: FieldHelpers,
  model: string,
  columnName: string,
  type: ColumnTypeDescriptor,
  enums: Map<string, NativeEnumHandle>,
  enumName: string | undefined,
): ScalarFieldBuilder {
  switch (type.type) {
    case 'text':
      return field.text()
    case 'varchar': {
      const length = firstNumber(type.args, 0)
      return length === undefined ? field.text() : field.column(varcharColumn(length))
    }
    case 'char': {
      const length = firstNumber(type.args, 0)
      if (length === undefined) {
        throw new Error(`Model "${model}", column "${columnName}": a char column needs a length`)
      }
      return field.column(charColumn(length))
    }
    case 'int':
      return field.int()
    case 'smallint':
      return field.column(int2Column)
    case 'bigint':
      return field.bigint()
    case 'decimal': {
      const precision = firstNumber(type.args, 0)
      return precision === undefined
        ? field.decimal()
        : field.column(numericColumn(precision, firstNumber(type.args, 1)))
    }
    case 'float':
      return field.float()
    case 'boolean':
      return field.boolean()
    case 'dateTime':
    case 'timestamptz':
      return field.column(timestamptzStringColumn)
    case 'timestamp':
      return field.column(timestampStringColumn)
    case 'date':
      return field.column(dateStringColumn)
    case 'uuid':
      return field.uuidNative()
    case 'json':
    case 'jsonb':
      return field.json()
    case 'bytes':
      return field.bytes()
    case 'enum': {
      const handle = enumName === undefined ? undefined : enums.get(enumName)
      if (!handle) {
        throw new Error(
          `Model "${model}", column "${columnName}": enum column names no declared enum${enumName ? ` ("${enumName}")` : ''}`,
        )
      }
      return field.column(pg.enum(handle))
    }
    default:
      throw new Error(
        `Model "${model}", column "${columnName}": the Postgres pack has no type "${type.type}"`,
      )
  }
}

function idField(field: FieldHelpers, id: ContractIdColumn): ScalarFieldBuilder {
  switch (id.strategy) {
    case 'uuid7':
      return field.id.uuidv7Native()
    case 'cuid2':
      return field.id.cuid2()
    case 'int autoincrement':
      return field.int().defaultSql('autoincrement()').id()
    case 'singleton':
      return field.int().default(1).id()
  }
}

function scalarField(
  helpers: AuthoringHelpers,
  model: string,
  column: ContractColumn,
  enums: Map<string, NativeEnumHandle>,
): ScalarFieldBuilder {
  let builder =
    column.type.pack === 'pg'
      ? pgColumn(helpers.field, model, column.name, column.type, enums, column.enum?.name)
      : helpers.field.column(extensionColumnType(helpers, model, column))
  if (column.nullable) builder = builder.optional()
  if (column.map !== undefined) builder = builder.column(column.map)
  if (column.unique) builder = builder.unique()
  if (column.default?.kind === 'literal') builder = builder.default(column.default.value)
  if (column.default?.kind === 'now') builder = builder.defaultSql('now()')
  return builder
}

function modelFields(
  helpers: AuthoringHelpers,
  model: ContractModel,
  enums: Map<string, NativeEnumHandle>,
): Fields {
  const fields: Fields = { id: idField(helpers.field, model.id) }
  for (const column of model.columns) {
    fields[column.name] = scalarField(helpers, model.name, column, enums)
  }
  if (model.timestamps.createdAt) fields.createdAt = helpers.field.temporal.createdAtString()
  if (model.timestamps.updatedAt) fields.updatedAt = helpers.field.temporal.updatedAtString()
  return fields
}

function nativeEnums(data: ContractData): Map<string, NativeEnumHandle> {
  const handles = new Map<string, NativeEnumHandle>()
  for (const { name, values } of data.enums) {
    const [first, ...rest] = values
    if (first === undefined) {
      throw new Error(`Enum "${name}" declares no values`)
    }
    handles.set(name, nativeEnum(name, first, ...rest))
  }
  return handles
}

function baseModel(
  helpers: AuthoringHelpers,
  model: ContractModel,
  enums: Map<string, NativeEnumHandle>,
  relations: Relations,
) {
  return helpers.model(model.name, {
    fields: modelFields(helpers, model, enums),
    relations,
    ...(model.namespace !== undefined ? { namespace: model.namespace } : {}),
  })
}

type ModelToken = ReturnType<typeof baseModel>

function finishModel(base: ModelToken, model: ContractModel, tokens: Record<string, ModelToken>) {
  const uniqueIndexes = model.indexes.filter((index) => index.unique)
  const plainIndexes = model.indexes.filter((index) => !index.unique)
  const indexedColumns = model.columns.filter((column) => column.index)
  return base
    .attributes(({ fields, constraints }) => ({
      uniques: uniqueIndexes.map((index) =>
        constraints.unique(
          index.columns.map((column) => fields[column]),
          index.name !== undefined ? { name: index.name } : {},
        ),
      ),
    }))
    .sql(({ cols, constraints }) => ({
      ...(model.table !== undefined ? { table: model.table } : {}),
      indexes: [
        ...indexedColumns.map((column) => constraints.index([cols[column.name]])),
        ...plainIndexes.map((index) =>
          constraints.index(
            index.columns.map((column) => cols[column]),
            index.name !== undefined ? { name: index.name } : {},
          ),
        ),
      ],
      foreignKeys: model.foreignKeys.map((fk) =>
        constraints.foreignKey(cols[fk.column], tokens[fk.references.model].refs.id, {
          index: false,
          ...(fk.onDelete !== undefined ? { onDelete: fk.onDelete } : {}),
          ...(fk.onUpdate !== undefined ? { onUpdate: fk.onUpdate } : {}),
        }),
      ),
    }))
}

/**
 * Feed {@link ContractData} into Prisma's contract builder and return the
 * built contract — the in-process equivalent of rendering the Contract
 * module and running `prisma contract emit` (ADR-0057). The builder
 * validates as it builds, so an invalid derivation throws here.
 *
 * Entry points relied on (`@prisma/orm-postgres@8.0.0-rc.8`): the callback
 * overload of `defineContract` from `/contract-builder` for the `field`,
 * `model`, `rel` and `type` helpers; `field.id.uuidv7Native()`,
 * `field.id.cuid2()`, `field.int().defaultSql('autoincrement()').id()`;
 * `field.temporal.createdAtString()`/`updatedAtString()`; `nativeEnum` +
 * `pg.enum`; the raw column descriptors from `/adapter/column-types` for the
 * constructors the presets do not parameterise; `model(...).attributes({ uniques })` and
 * `.sql({ table, indexes, foreignKeys })` with `constraints.foreignKey(col,
 * Model.refs.id, { onDelete, onUpdate })`; and the thunk form of
 * `rel.belongsTo`/`hasOne`/`hasMany` for forward and self references.
 *
 * @example
 * ```typescript
 * import pgvector from '@prisma/orm-extension-pgvector/pack'
 * const contract = buildPrismaContract(deriveContract(config), { packs: { pgvector } })
 * const db = postgres({ contract, url })
 * ```
 *
 * Every date/time column — `dateTime`, `timestamp`, `date` and the two
 * auto-timestamps — is bound to the pack's `-string` codec rather than its
 * `-temporal` twin. The temporal codecs, and the `instantNow` generator
 * behind `temporal.updatedAt()`, require a global `Temporal`, which no
 * supported Node release ships (ADR-0048's re-verification row). The
 * string codecs read and write ISO-8601 text; the column type is the same.
 *
 * Known limits:
 * - A `timestamp`/`timestamptz` precision argument is dropped; the pack's
 *   column descriptors carry none.
 */
export function buildPrismaContract(
  data: ContractData,
  options: BuildPrismaContractOptions = {},
): PrismaContract {
  const packs: PrismaContractPacks = {}
  for (const extension of data.extensions) {
    const pack = options.packs?.[extension.name]
    if (!pack) {
      throw new Error(
        `Extension pack "${extension.name}" (from "${extension.from}") is declared by the contract but was not passed in options.packs`,
      )
    }
    packs[extension.name] = pack
  }
  const enums = nativeEnums(data)

  return defineContract({ extensions: packs }, (helpers) => {
    const tokens: Record<string, ModelToken> = {}
    for (const model of data.models) {
      const relations: Relations = {}
      for (const relation of model.relations) {
        const target = () => tokens[relation.target]
        relations[relation.name] =
          relation.kind === 'belongsTo'
            ? helpers.rel.belongsTo(target, { from: relation.column, to: 'id' })
            : relation.kind === 'hasOne'
              ? helpers.rel.hasOne(target, { by: relation.column })
              : helpers.rel.hasMany(target, { by: relation.column })
      }
      tokens[model.name] = baseModel(helpers, model, enums, relations)
    }
    const models: Record<string, ReturnType<typeof finishModel>> = {}
    for (const model of data.models) {
      models[model.name] = finishModel(tokens[model.name], model, tokens)
    }
    return { models }
  })
}

/**
 * The JSON form of a built contract — what `prisma contract emit` writes to
 * `contract.json` (minus `schemaVersion` and `_generated`), and what
 * {@link assertRelationGraphAgrees} reads.
 */
export function toEmittedContract(contract: PrismaContract): EmittedContract {
  return JSON.parse(JSON.stringify(contract))
}
