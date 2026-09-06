import { createAdapterFactory } from 'better-auth/adapters'
import { codecOf, param } from '@prisma/orm-postgres/relational-core'
import type { AdapterFactory, CleanedWhere, CustomAdapter } from 'better-auth/adapters'
import type { BetterAuthOptions } from 'better-auth'
import type { CodecRef, Expression, ScopeField } from '@prisma/orm-postgres/relational-core'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { UnsafeSurface } from '@opensaas/stack-core/unsafe'
import {
  authCollection,
  authSqlTable,
  type AuthCollection,
  type AuthRow,
  type AuthSqlFieldProxy,
  type AuthSqlFunctions,
} from './surface.js'
import { applyOrmWhere, sqlWhere, type AuthFieldResolution } from './where.js'

export { AuthModelUnreachableError } from './surface.js'
export { AuthWhereError } from './where.js'

/** Thrown when the adapter cannot carry out an operation better-auth asked for. */
export class AuthAdapterError extends Error {
  constructor(message: string) {
    super(`[@opensaas/stack-auth] ${message}`)
    this.name = 'AuthAdapterError'
  }
}

/**
 * Thrown when better-auth asks for a model the derived Auth lists do not carry.
 *
 * The registry is built by the same `deriveAuthLists` call that produced the
 * lists, so a miss means better-auth is running with a plugin the OpenSaaS
 * config was not built with — the table was never generated.
 */
export class AuthModelUnregisteredError extends Error {
  constructor(
    readonly model: string,
    readonly registered: readonly string[],
  ) {
    super(
      `[@opensaas/stack-auth] better-auth asked for model "${model}", which \`authPlugin\` ` +
        `derived no list for. Registered models: ${registered.join(', ') || '(none)'}. ` +
        `Pass a better-auth plugin to \`authPlugin({ betterAuthPlugins })\` so its tables ` +
        `reach the generated schema.`,
    )
    this.name = 'AuthModelUnregisteredError'
  }
}

/** How the adapter reaches one better-auth model on the two lanes. */
interface ModelCoordinate {
  readonly listKey: string
  readonly table: string
  readonly namespace: string
}

/** What {@link opensaasAuthAdapter} needs to address the database. */
export interface OpenSaasAuthAdapterOptions {
  /** The resolved OpenSaaS config, for each derived list's table and schema. */
  config: OpenSaasConfig
  /** The running context's Unsafe surface — the lanes every operation runs on. */
  unsafe: UnsafeSurface
  /** better-auth model key → derived list key, from `getAuthListRegistry`. */
  registry: Record<string, string>
}

/**
 * better-auth types every row-returning adapter method as answering the
 * caller's own `T`, which no adapter can produce — the row comes from the
 * database, not from the caller. Its own reference adapters widen at this
 * seam; this is the one place ours does.
 */
function asAdapterResult<T>(row: unknown): T {
  return row as T
}

/**
 * Rename a row's keys, passing through anything the mapping does not resolve.
 *
 * An application's own additions to a derived list (`extendUserList`) are real
 * columns and reach the row, but better-auth's schema has never heard of them,
 * so they travel under their own names rather than failing the read.
 */
function renameKeys(
  row: Record<string, unknown>,
  rename: (key: string) => string | undefined,
): AuthRow {
  const renamed: AuthRow = {}
  for (const [key, value] of Object.entries(row)) {
    renamed[rename(key) ?? key] = value
  }
  return renamed
}

/**
 * The stack-authored better-auth adapter: better-auth's own adapter factory
 * over the Unsafe surface (ADR-0060).
 *
 * Eight of the ten methods are Collection calls on the surface's ORM lane.
 * `incrementOne` and an unconditional `deleteMany` are single typed-SQL
 * statements through the surface's executors, because a Collection expresses
 * neither `SET n = n + δ` nor a `DELETE` with no `WHERE`.
 *
 * Every query runs marked as intentionally unscoped: this is auth's own
 * bookkeeping, outside the Access Filter by construction (ADR-0038, ADR-0049).
 *
 * Known limits:
 * - **No joins.** `advanced.database.joins` is refused at config time rather
 *   than left to the factory's silent per-model fallback.
 * - **No `createSchema`.** The Auth lists derive from `getAuthTables` and the
 *   stack's generator emits the contract, so better-auth's CLI (`generate`,
 *   `migrate`) is unsupported against this adapter.
 * - **No transaction option**, so the factory runs a transaction callback
 *   against the plain adapter with no atomicity.
 * - Errors arrive as the driver's own: the Unsafe surface is excluded from the
 *   stack's error normalisation (ADR-0042).
 */
export function opensaasAuthAdapter(
  options: OpenSaasAuthAdapterOptions,
): AdapterFactory<BetterAuthOptions> {
  const { config, unsafe, registry } = options

  function coordinate(model: string, toModelKey: (model: string) => string): ModelCoordinate {
    const listKey = registry[toModelKey(model)]
    if (listKey === undefined) {
      throw new AuthModelUnregisteredError(model, Object.keys(registry))
    }
    const listDb = config.lists[listKey]?.db
    return { listKey, table: listDb?.map ?? listKey, namespace: listDb?.schema ?? 'public' }
  }

  return createAdapterFactory<BetterAuthOptions>({
    config: {
      adapterId: 'opensaas-stack',
      adapterName: 'OpenSaaS Stack',
      // The database mints every id: `authPlugin` pins `db.idField: 'uuid7'`
      // on each list it injects, so the column carries its own default and
      // better-auth must not send one of its own (ADR-0048, ADR-0060).
      disableIdGeneration: true,
      supportsUUIDs: true,
      supportsNumericIds: false,
      // Prisma's `timestamptz` codec decodes to a string at 8.0.0-rc.8, so the
      // factory's own string↔Date conversion is what keeps better-auth's
      // contract (it hands out `Date`s) true.
      supportsDates: false,
      supportsBooleans: true,
      // better-auth's `json` and array field types derive to `text()` columns,
      // so the factory serialises them rather than the database.
      supportsJSON: false,
      supportsArrays: false,
      transaction: false,
    },
    adapter: ({
      getDefaultModelName,
      getDefaultFieldName,
      getFieldName,
      getFieldAttributes,
      schema,
    }): CustomAdapter => {
      const at = (model: string): ModelCoordinate => coordinate(model, getDefaultModelName)

      const collectionFor = (model: string): AuthCollection => {
        const { namespace, listKey } = at(model)
        return authCollection(unsafe, namespace, listKey)
      }

      const toFieldKey =
        (model: string) =>
        (column: string): string => {
          try {
            return getDefaultFieldName({ model, field: column })
          } catch {
            return column
          }
        }

      const toColumn =
        (model: string) =>
        (fieldKey: string): string | undefined => {
          try {
            return getFieldName({ model, field: fieldKey })
          } catch {
            return undefined
          }
        }

      /**
       * better-auth carries an `int8` column's value as a JS number, which
       * Prisma's `pg/int8` codec refuses — it takes a `bigint` and nothing
       * else. The attribute's own `bigint` flag is what says which columns
       * those are.
       */
      const isBigInt = (model: string, fieldKey: string): boolean => {
        try {
          return getFieldAttributes({ model, field: fieldKey }).bigint === true
        } catch {
          return false
        }
      }

      const resolveField =
        (model: string) =>
        (column: string): AuthFieldResolution => {
          const key = toFieldKey(model)(column)
          return { key, isBigInt: isBigInt(model, key) }
        }

      const narrow = (model: string, where: readonly CleanedWhere[]): AuthCollection =>
        applyOrmWhere(collectionFor(model), where, resolveField(model))

      const outward = (model: string, row: AuthRow | null): AuthRow | null => {
        if (row === null) return null
        const narrowed: AuthRow = {}
        for (const [key, value] of Object.entries(row)) {
          narrowed[key] = typeof value === 'bigint' ? Number(value) : value
        }
        return renameKeys(narrowed, toColumn(model))
      }

      const inward = (model: string, data: Record<string, unknown>): AuthRow => {
        const widened: AuthRow = {}
        for (const [column, value] of Object.entries(data)) {
          const field = resolveField(model)(column)
          widened[field.key] = field.isBigInt && typeof value === 'number' ? BigInt(value) : value
        }
        return widened
      }

      /** Every column better-auth declares for a model, for a `RETURNING` list. */
      const columnsOf = (model: string): string[] => {
        const fields = schema[getDefaultModelName(model)]?.fields ?? {}
        return ['id', ...Object.keys(fields).map((field) => getFieldName({ model, field }))]
      }

      const project = (
        collection: AuthCollection,
        model: string,
        select?: string[],
      ): AuthCollection =>
        !select || select.length === 0
          ? collection
          : collection.select(...select.map(toFieldKey(model)))

      /** A column's own codec, so a raw fragment carries the type the column declares. */
      const codecFor = (
        fields: AuthSqlFieldProxy,
        table: string,
        column: string,
      ): { target: Expression<ScopeField>; codec: CodecRef } => {
        const target = fields[column]
        const codec = target === undefined ? undefined : codecOf(target)
        if (target === undefined || codec === undefined) {
          throw new AuthAdapterError(
            `the typed-SQL lane exposes no column "${column}" on "${table}".`,
          )
        }
        return { target, codec }
      }

      return {
        async create({ model, data, select }) {
          const created = await project(collectionFor(model), model, select).create(
            inward(model, data),
          )
          return asAdapterResult(outward(model, created))
        },

        async findOne({ model, where, select }) {
          const found = await project(narrow(model, where), model, select).first()
          return asAdapterResult(outward(model, found))
        },

        async findMany({ model, where, limit, select, sortBy, offset }) {
          let collection = project(narrow(model, where ?? []), model, select)
          if (sortBy) {
            const fieldKey = toFieldKey(model)(sortBy.field)
            const descending = sortBy.direction === 'desc'
            collection = collection.orderBy((accessor) => {
              const field = accessor[fieldKey]
              if (!field) {
                throw new AuthAdapterError(
                  `the ORM lane exposes no field "${fieldKey}" on "${model}" to sort on.`,
                )
              }
              return descending ? field.desc() : field.asc()
            })
          }
          if (typeof offset === 'number') collection = collection.offset(offset)
          const rows = await collection.limit(limit).all()
          return asAdapterResult(rows.map((row) => outward(model, row)))
        },

        async count({ model, where }) {
          const counted = await narrow(model, where ?? []).aggregate((aggregate) => ({
            n: aggregate.count(),
          }))
          return counted.n
        },

        async update({ model, where, update }) {
          const updated = await narrow(model, where).update(
            inward(model, { ...(update as Record<string, unknown>) }),
          )
          return asAdapterResult(outward(model, updated))
        },

        async updateMany({ model, where, update }) {
          return await narrow(model, where).updateAndCount(inward(model, update))
        },

        async delete({ model, where }) {
          await narrow(model, where).delete()
        },

        async deleteMany({ model, where }) {
          if (where.length > 0) return await narrow(model, where).deleteAndCount()

          // A Collection's `deleteAndCount` is checked against a prior
          // `.where()`, so the unconditional delete better-auth's own test
          // cleanup issues has to be the typed-SQL statement instead.
          const { namespace, table } = at(model)
          const stats = await unsafe.execute(
            authSqlTable(unsafe, namespace, table).delete().build(),
          )
          return stats.affectedRows
        },

        async consumeOne({ model, where }) {
          // Prisma resolves the first matching identity and deletes by it with
          // `RETURNING`, so of two racing consumers exactly one gets the row —
          // the at-most-one guarantee better-auth asks of this method.
          const consumed = await narrow(model, where).delete()
          return asAdapterResult(outward(model, consumed))
        },

        async incrementOne({ model, where, increment, set }) {
          const { namespace, table } = at(model)
          const plan = authSqlTable(unsafe, namespace, table)
            .update((fields: AuthSqlFieldProxy, fns: AuthSqlFunctions) => {
              const assignments: Record<string, Expression<ScopeField>> = {}
              for (const [column, delta] of Object.entries(increment)) {
                const { target, codec } = codecFor(fields, table, column)
                assignments[column] = fns.raw`${target} + ${delta}`.returns({
                  codecId: codec.codecId,
                  nullable: true,
                })
              }
              for (const [column, value] of Object.entries(set ?? {})) {
                const { codec } = codecFor(fields, table, column)
                const widened =
                  resolveField(model)(column).isBigInt && typeof value === 'number'
                    ? BigInt(value)
                    : value
                assignments[column] =
                  fns.raw`${param(widened, { codecId: codec.codecId })}`.returns({
                    codecId: codec.codecId,
                    nullable: true,
                  })
              }
              return assignments
            })
            .where((fields, fns) => sqlWhere(fields, fns, where, resolveField(model)))
            .returning(...columnsOf(model))
            .build()

          const updated = await unsafe.query<AuthRow>(plan).first()
          return asAdapterResult(outward(model, updated))
        },
      }
    },
  })
}
