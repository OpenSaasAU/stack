import type {
  AnyExpression,
  CodecRef,
  Expression,
  OrderByItem,
  RawSqlBuilder,
  ScopeField,
  SqlOrmPlan,
} from '@prisma/orm-postgres/relational-core'
import type { UnsafeSurface } from '@opensaas/stack-core/unsafe'

/**
 * A row as the Auth adapter handles it: keyed by field key while it is on a
 * Collection, by better-auth's column name once it is back at the factory.
 */
export type AuthRow = Record<string, unknown>

/** Every value better-auth's `Where` vocabulary can carry into a predicate. */
export type AuthValue = string | number | bigint | boolean | Date | null

/**
 * The column operators the adapter reaches for, as Prisma's field proxy
 * declares them. `ilike` is contributed by the Postgres target's operation
 * types rather than by the shared set — it is there because the active target
 * is Postgres.
 */
export interface AuthFieldProxy {
  eq(value: AuthValue): AnyExpression
  neq(value: AuthValue): AnyExpression
  gt(value: AuthValue): AnyExpression
  gte(value: AuthValue): AnyExpression
  lt(value: AuthValue): AnyExpression
  lte(value: AuthValue): AnyExpression
  like(pattern: string): AnyExpression
  ilike(pattern: string): AnyExpression
  in(values: readonly AuthValue[]): AnyExpression
  notIn(values: readonly AuthValue[]): AnyExpression
  isNull(): AnyExpression
  isNotNull(): AnyExpression
  asc(): OrderByItem
  desc(): OrderByItem
}

export type AuthModelAccessor = Record<string, AuthFieldProxy>

/** Prisma's aggregate builder, narrowed to the one aggregate `count` needs. */
export interface AuthAggregateBuilder {
  count(): number
}

/**
 * The part of a Prisma `Collection` the adapter drives.
 *
 * Declared structurally rather than imported: the Unsafe surface types its ORM
 * lane as `object` — it is built from a structural client, not from the app's
 * emitted contract — and the adapter addresses models by a name resolved at
 * runtime, so there is no contract-typed collection to name here.
 */
export interface AuthCollection {
  where(fn: (model: AuthModelAccessor) => AnyExpression): AuthCollection
  select(...fields: string[]): AuthCollection
  orderBy(fn: (model: AuthModelAccessor) => OrderByItem): AuthCollection
  limit(n: number): AuthCollection
  offset(n: number): AuthCollection
  all(): PromiseLike<AuthRow[]>
  first(): Promise<AuthRow | null>
  aggregate(fn: (aggregate: AuthAggregateBuilder) => { n: number }): Promise<{ n: number }>
  create(data: AuthRow): Promise<AuthRow>
  update(data: AuthRow): Promise<AuthRow | null>
  updateAndCount(data: AuthRow): Promise<number>
  delete(): Promise<AuthRow | null>
  deleteAndCount(): Promise<number>
}

/** Prisma's SQL-builder expression namespace, narrowed to what the two typed-SQL methods need. */
export interface AuthSqlFunctions {
  eq(a: Expression<ScopeField>, b: AuthValue): Expression<ScopeField>
  ne(a: Expression<ScopeField>, b: AuthValue): Expression<ScopeField>
  gt(a: Expression<ScopeField>, b: AuthValue): Expression<ScopeField>
  gte(a: Expression<ScopeField>, b: AuthValue): Expression<ScopeField>
  lt(a: Expression<ScopeField>, b: AuthValue): Expression<ScopeField>
  lte(a: Expression<ScopeField>, b: AuthValue): Expression<ScopeField>
  and(...exprs: Expression<ScopeField>[]): Expression<ScopeField>
  or(...exprs: Expression<ScopeField>[]): Expression<ScopeField>
  in(expr: Expression<ScopeField>, values: readonly AuthValue[]): Expression<ScopeField>
  notIn(expr: Expression<ScopeField>, values: readonly AuthValue[]): Expression<ScopeField>
  ilike(expr: Expression<ScopeField>, pattern: string): Expression<ScopeField>
  readonly raw: (strings: TemplateStringsArray, ...values: unknown[]) => RawSqlBuilder
}

export type AuthSqlFieldProxy = Record<string, Expression<ScopeField>>

export interface AuthSqlStatement {
  where(
    expr: (fields: AuthSqlFieldProxy, fns: AuthSqlFunctions) => Expression<ScopeField>,
  ): AuthSqlStatement
  returning(...columns: string[]): AuthSqlStatement
  build(): SqlOrmPlan<AuthRow>
}

/** The part of Prisma's table-shaped SQL builder the two typed-SQL methods use. */
export interface AuthSqlTable {
  update(
    set: (
      fields: AuthSqlFieldProxy,
      fns: AuthSqlFunctions,
    ) => Record<string, Expression<ScopeField>>,
  ): AuthSqlStatement
  delete(): AuthSqlStatement
}

/** A column's codec, as `codecOf` reports it for a field-proxy expression. */
export type AuthCodecRef = CodecRef

/**
 * Thrown when the Unsafe surface's lanes carry nothing usable at the
 * coordinate the Auth adapter derived for a better-auth model.
 *
 * The coordinate comes from the derived Auth lists, so a miss means the
 * running client and the config disagree about what the database holds — a
 * generation or wiring fault, reported rather than run against `undefined`.
 */
export class AuthModelUnreachableError extends Error {
  constructor(
    readonly lane: 'orm' | 'sql',
    readonly namespace: string,
    readonly entity: string,
  ) {
    super(
      `[@opensaas/stack-auth] The Unsafe surface exposes no ` +
        `${lane === 'orm' ? 'collection' : 'table'} at ${lane}."${namespace}"."${entity}". ` +
        `The Auth adapter addresses the lists \`authPlugin\` derives, so re-run ` +
        `\`opensaas generate\` and confirm the emitted contract carries them.`,
    )
    this.name = 'AuthModelUnreachableError'
  }
}

function reach(container: unknown, key: string): unknown {
  if (container === null || (typeof container !== 'object' && typeof container !== 'function')) {
    return undefined
  }
  return Reflect.get(container, key)
}

function hasMethods(value: unknown, methods: readonly string[]): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  return methods.every((method) => typeof Reflect.get(value, method) === 'function')
}

function isCollection(value: unknown): value is AuthCollection {
  return hasMethods(value, ['where', 'select', 'all', 'first', 'create', 'aggregate'])
}

function isSqlTable(value: unknown): value is AuthSqlTable {
  return hasMethods(value, ['update', 'delete'])
}

/**
 * Resolve one lane's entry for a model, namespace coordinate first.
 *
 * Prisma keys both lanes by namespace and keeps a flat alias for names that
 * are unique across the contract. The coordinate is the form that always
 * resolves, so it is tried first and the flat form is the fallback.
 */
function resolve<T>(
  lane: unknown,
  namespace: string,
  entity: string,
  is: (value: unknown) => value is T,
): T | undefined {
  const namespaced = reach(reach(lane, namespace), entity)
  if (is(namespaced)) return namespaced
  const flat = reach(lane, entity)
  return is(flat) ? flat : undefined
}

/** The marked Collection for a list, off the Unsafe surface's ORM lane. */
export function authCollection(
  unsafe: UnsafeSurface,
  namespace: string,
  listKey: string,
): AuthCollection {
  const collection = resolve(unsafe.orm, namespace, listKey, isCollection)
  if (!collection) throw new AuthModelUnreachableError('orm', namespace, listKey)
  return collection
}

/** The typed-SQL builder for a list's table, off the Unsafe surface's SQL lane. */
export function authSqlTable(
  unsafe: UnsafeSurface,
  namespace: string,
  table: string,
): AuthSqlTable {
  const builder = resolve(unsafe.sql, namespace, table, isSqlTable)
  if (!builder) throw new AuthModelUnreachableError('sql', namespace, table)
  return builder
}
