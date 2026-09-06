import { not, or } from '@prisma/orm-postgres/orm-client'
import {
  likeContainsPattern,
  likeEndsWithPattern,
  likeEqualsPattern,
  likeStartsWithPattern,
} from '@opensaas/stack-core/internal'
import type { AnyExpression, Expression, ScopeField } from '@prisma/orm-postgres/relational-core'
import type { CleanedWhere } from 'better-auth/adapters'
import type {
  AuthCollection,
  AuthFieldProxy,
  AuthModelAccessor,
  AuthSqlFieldProxy,
  AuthSqlFunctions,
  AuthValue,
} from './surface.js'

/**
 * Thrown when a `where` clause names something the lane cannot address, or
 * carries a value the operator cannot take. better-auth validates neither
 * before handing the clause over, so this is where the mismatch is named.
 */
export class AuthWhereError extends Error {
  constructor(message: string) {
    super(`[@opensaas/stack-auth] ${message}`)
    this.name = 'AuthWhereError'
  }
}

/**
 * How one better-auth column resolves against the model being queried: the
 * field key the ORM lane is keyed by, and whether the column's codec is an
 * `int8` — better-auth carries those values as JS numbers, Prisma's codec
 * refuses anything but a `bigint`.
 */
export interface AuthFieldResolution {
  readonly key: string
  readonly isBigInt: boolean
}

function widen(value: AuthValue, isBigInt: boolean): AuthValue {
  return isBigInt && typeof value === 'number' ? BigInt(value) : value
}

function scalar(clause: CleanedWhere, isBigInt = false): AuthValue {
  if (Array.isArray(clause.value)) {
    throw new AuthWhereError(
      `operator "${clause.operator}" on "${clause.field}" takes a single value, got an array.`,
    )
  }
  return widen(clause.value, isBigInt)
}

function list(clause: CleanedWhere, isBigInt = false): readonly AuthValue[] {
  if (!Array.isArray(clause.value)) {
    throw new AuthWhereError(
      `operator "${clause.operator}" on "${clause.field}" takes an array, got ${typeof clause.value}.`,
    )
  }
  return clause.value.map((entry) => widen(entry, isBigInt))
}

function pattern(clause: CleanedWhere, build: (value: string) => string): string {
  if (typeof clause.value !== 'string') {
    throw new AuthWhereError(
      `operator "${clause.operator}" on "${clause.field}" takes a string, got ${typeof clause.value}.`,
    )
  }
  return build(clause.value)
}

function isInsensitive(clause: CleanedWhere): boolean {
  return clause.mode === 'insensitive' && typeof clause.value === 'string'
}

function insensitiveList(clause: CleanedWhere): readonly string[] | undefined {
  if (clause.mode !== 'insensitive' || !Array.isArray(clause.value)) return undefined
  const strings = clause.value.filter((entry): entry is string => typeof entry === 'string')
  return strings.length === clause.value.length ? strings : undefined
}

/** One better-auth clause as an ORM-lane predicate on `field`. */
function ormClause(field: AuthFieldProxy, clause: CleanedWhere, isBigInt: boolean): AnyExpression {
  switch (clause.operator) {
    case 'eq':
      if (clause.value === null) return field.isNull()
      if (isInsensitive(clause)) return field.ilike(pattern(clause, likeEqualsPattern))
      return field.eq(scalar(clause, isBigInt))
    case 'ne': {
      if (clause.value === null) return field.isNotNull()
      if (isInsensitive(clause)) return not(field.ilike(pattern(clause, likeEqualsPattern)))
      return field.neq(scalar(clause, isBigInt))
    }
    case 'lt':
      return field.lt(scalar(clause, isBigInt))
    case 'lte':
      return field.lte(scalar(clause, isBigInt))
    case 'gt':
      return field.gt(scalar(clause, isBigInt))
    case 'gte':
      return field.gte(scalar(clause, isBigInt))
    case 'in': {
      const insensitive = insensitiveList(clause)
      if (insensitive) return or(...insensitive.map((v) => field.ilike(likeEqualsPattern(v))))
      return field.in(list(clause, isBigInt))
    }
    case 'not_in': {
      const insensitive = insensitiveList(clause)
      if (insensitive) return not(or(...insensitive.map((v) => field.ilike(likeEqualsPattern(v)))))
      return field.notIn(list(clause, isBigInt))
    }
    case 'contains':
      return isInsensitive(clause)
        ? field.ilike(pattern(clause, likeContainsPattern))
        : field.like(pattern(clause, likeContainsPattern))
    case 'starts_with':
      return isInsensitive(clause)
        ? field.ilike(pattern(clause, likeStartsWithPattern))
        : field.like(pattern(clause, likeStartsWithPattern))
    case 'ends_with':
      return isInsensitive(clause)
        ? field.ilike(pattern(clause, likeEndsWithPattern))
        : field.like(pattern(clause, likeEndsWithPattern))
  }
}

function proxyFor(
  model: AuthModelAccessor,
  fieldKey: string,
  clause: CleanedWhere,
): AuthFieldProxy {
  const field = model[fieldKey]
  if (!field) {
    throw new AuthWhereError(
      `the ORM lane exposes no field "${fieldKey}" (better-auth column "${clause.field}") on this model.`,
    )
  }
  return field
}

/**
 * Narrow `collection` by better-auth's flat clause list.
 *
 * better-auth's connectors group rather than nest: every `AND` clause holds,
 * and the `OR` clauses hold as one disjunction alongside them. That is the
 * shape its own reference adapters build, so it is the shape here.
 */
export function applyOrmWhere(
  collection: AuthCollection,
  clauses: readonly CleanedWhere[],
  resolve: (column: string) => AuthFieldResolution,
): AuthCollection {
  const predicate = (model: AuthModelAccessor, clause: CleanedWhere): AnyExpression => {
    const field = resolve(clause.field)
    return ormClause(proxyFor(model, field.key, clause), clause, field.isBigInt)
  }

  let narrowed = collection
  const disjuncts: CleanedWhere[] = []

  for (const clause of clauses) {
    if (clause.connector === 'OR') {
      disjuncts.push(clause)
      continue
    }
    narrowed = narrowed.where((model) => predicate(model, clause))
  }

  if (disjuncts.length === 1) {
    const only = disjuncts[0]
    return narrowed.where((model) => predicate(model, only))
  }
  if (disjuncts.length > 1) {
    return narrowed.where((model) => or(...disjuncts.map((clause) => predicate(model, clause))))
  }
  return narrowed
}

const BOOLEAN_CODEC = { codecId: 'pg/bool@1', nullable: false } as const

/**
 * One better-auth clause as a typed-SQL predicate.
 *
 * `like` has no builtin in Prisma's `fns` namespace — the Postgres target
 * contributes `ilike` and nothing else — so a case-sensitive pattern goes
 * through `fns.raw`, which is the documented seam for an expression fragment
 * the builder does not model.
 */
function sqlClause(
  column: Expression<ScopeField>,
  fns: AuthSqlFunctions,
  clause: CleanedWhere,
  isBigInt: boolean,
): Expression<ScopeField> {
  const like = (build: (value: string) => string): Expression<ScopeField> =>
    fns.raw`${column} LIKE ${pattern(clause, build)}`.returns(BOOLEAN_CODEC)

  switch (clause.operator) {
    case 'eq':
      return isInsensitive(clause)
        ? fns.ilike(column, pattern(clause, likeEqualsPattern))
        : fns.eq(column, scalar(clause, isBigInt))
    case 'ne':
      return fns.ne(column, scalar(clause, isBigInt))
    case 'lt':
      return fns.lt(column, scalar(clause, isBigInt))
    case 'lte':
      return fns.lte(column, scalar(clause, isBigInt))
    case 'gt':
      return fns.gt(column, scalar(clause, isBigInt))
    case 'gte':
      return fns.gte(column, scalar(clause, isBigInt))
    case 'in':
      return fns.in(column, list(clause, isBigInt))
    case 'not_in':
      return fns.notIn(column, list(clause, isBigInt))
    case 'contains':
      return isInsensitive(clause)
        ? fns.ilike(column, pattern(clause, likeContainsPattern))
        : like(likeContainsPattern)
    case 'starts_with':
      return isInsensitive(clause)
        ? fns.ilike(column, pattern(clause, likeStartsWithPattern))
        : like(likeStartsWithPattern)
    case 'ends_with':
      return isInsensitive(clause)
        ? fns.ilike(column, pattern(clause, likeEndsWithPattern))
        : like(likeEndsWithPattern)
  }
}

/** better-auth's clause list as one typed-SQL predicate, grouped the same way. */
export function sqlWhere(
  fields: AuthSqlFieldProxy,
  fns: AuthSqlFunctions,
  clauses: readonly CleanedWhere[],
  resolve: (column: string) => AuthFieldResolution,
): Expression<ScopeField> {
  const conjuncts: Expression<ScopeField>[] = []
  const disjuncts: Expression<ScopeField>[] = []

  for (const clause of clauses) {
    const column = fields[clause.field]
    if (!column) {
      throw new AuthWhereError(
        `the typed-SQL lane exposes no column "${clause.field}" on this table.`,
      )
    }
    const predicate = sqlClause(column, fns, clause, resolve(clause.field).isBigInt)
    if (clause.connector === 'OR') disjuncts.push(predicate)
    else conjuncts.push(predicate)
  }

  if (disjuncts.length > 0) {
    conjuncts.push(disjuncts.length === 1 ? disjuncts[0] : fns.or(...disjuncts))
  }
  if (conjuncts.length === 0) {
    throw new AuthWhereError('a guarded update needs at least one where clause.')
  }
  return conjuncts.length === 1 ? conjuncts[0] : fns.and(...conjuncts)
}
