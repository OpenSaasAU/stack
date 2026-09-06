import type { IsToOne, ListId, RelationKey, RelationTarget, RemainderBase } from './contract.js'
import type { CreateInput, UpdateInput } from './inputs.js'
import type { RelationValue, Row, StoredRow } from './rows.js'

/**
 * One column's filter. The operator vocabulary is the one the engine lowers
 * today; ADR-0055 replaces it with the secured surface's own `where` grammar
 * in the runtime spec. What this type pins now is the **key** set: a `where`
 * naming a column the list does not have is a compile error.
 */
export type ColumnFilter<V> =
  | V
  | {
      equals?: V
      not?: V
      in?: V[]
      notIn?: V[]
      lt?: V
      lte?: V
      gt?: V
      gte?: V
      contains?: string
      startsWith?: string
      endsWith?: string
      mode?: 'default' | 'insensitive'
    }

type RelationFilter<C, R extends RemainderBase, K extends keyof R & string, Rel> =
  RelationTarget<C, K, Rel> extends infer Target
    ? Target extends keyof R & string
      ? IsToOne<C, K, Rel> extends true
        ? { is?: ListWhere<C, R, Target> | null; isNot?: ListWhere<C, R, Target> | null }
        : {
            some?: ListWhere<C, R, Target>
            every?: ListWhere<C, R, Target>
            none?: ListWhere<C, R, Target>
          }
      : never
    : never

/** A `where` over the list's own columns and relations, plus the boolean combinators. */
export type ListWhere<C, R extends RemainderBase, K extends keyof R & string> = {
  [F in keyof StoredRow<C, R, K>]?: ColumnFilter<StoredRow<C, R, K>[F]>
} & {
  [Rel in RelationKey<C, K>]?: RelationFilter<C, R, K, Rel>
} & {
  AND?: ListWhere<C, R, K> | ListWhere<C, R, K>[]
  OR?: ListWhere<C, R, K>[]
  NOT?: ListWhere<C, R, K> | ListWhere<C, R, K>[]
}

export type ListOrderBy<C, R extends RemainderBase, K extends keyof R & string> = {
  [F in keyof StoredRow<C, R, K>]?: 'asc' | 'desc'
}

export type ListUniqueWhere<C, R extends RemainderBase, K extends keyof R & string> = {
  [F in keyof StoredRow<C, R, K>]?: StoredRow<C, R, K>[F]
}

// ── selection ─────────────────────────────────────────────────────────────

/** Nested `select`/`include` on a relation the caller named. */
export type SubArgs<C, R extends RemainderBase, K extends keyof R & string> = {
  select?: ListSelect<C, R, K>
  include?: ListInclude<C, R, K>
}

/**
 * What a caller may `select`: any key the row carries. A relation key also
 * accepts nested args, so a selection narrows one hop down as well.
 */
export type ListSelect<C, R extends RemainderBase, K extends keyof R & string> = {
  [F in keyof Row<C, R, K>]?: F extends RelationKey<C, K>
    ? boolean | SubArgs<C, R, RelationTarget<C, K, F> & keyof R & string>
    : boolean
}

/** What a caller may `include`: any relation in the contract's graph. */
export type ListInclude<C, R extends RemainderBase, K extends keyof R & string> = {
  [Rel in RelationKey<C, K>]?: boolean | SubArgs<C, R, RelationTarget<C, K, Rel> & keyof R & string>
}

type SubResult<C, R extends RemainderBase, K extends keyof R & string, Rel, A> =
  RelationTarget<C, K, Rel> extends infer Target
    ? Target extends keyof R & string
      ? A extends { select: infer S }
        ? Arity<C, K, Rel, SelectResult<C, R, Target, S>>
        : A extends { include: infer I }
          ? Arity<C, K, Rel, Row<C, R, Target> & IncludeMembers<C, R, Target, I>>
          : RelationValue<C, R, K, Rel>
      : never
    : never

type Arity<C, K extends string, Rel, Value> =
  IsToOne<C, K, Rel> extends true ? Value | null : Value[]

type SelectResult<C, R extends RemainderBase, K extends keyof R & string, S> = {
  -readonly [
    F in keyof S & keyof Row<C, R, K> as S[F] extends false | undefined ? never : F
  ]-?: F extends RelationKey<C, K> ? SubResult<C, R, K, F, S[F]> : Row<C, R, K>[F]
}

type IncludeMembers<C, R extends RemainderBase, K extends keyof R & string, I> = {
  -readonly [
    Rel in keyof I & RelationKey<C, K> as I[Rel] extends false | undefined ? never : Rel
  ]-?: SubResult<C, R, K, Rel, I[Rel]>
}

/**
 * A terminal's result, narrowed by what the caller asked for: `select` picks
 * exactly the named keys, `include` keeps the whole row and makes the named
 * relations present, and a bare read is the row's scalars and computed fields.
 *
 * `S` and `I` are inferred from the `select` / `include` members alone, each
 * defaulting to `never` when the caller passed neither. Inferring them
 * separately — rather than one type parameter over the whole argument — is
 * what keeps `data` and `where` checked as concrete types: a parameter that
 * is itself a type variable loses object-literal freshness, so an unknown key
 * would slip through.
 */
export type QueryResult<C, R extends RemainderBase, K extends keyof R & string, S, I> = [
  S,
] extends [never]
  ? [I] extends [never]
    ? Row<C, R, K>
    : Row<C, R, K> & IncludeMembers<C, R, K, I>
  : SelectResult<C, R, K, S>

// ── operation arguments ───────────────────────────────────────────────────

type Selection<C, R extends RemainderBase, K extends keyof R & string> = {
  select?: ListSelect<C, R, K>
  include?: ListInclude<C, R, K>
}

/** Filtering, ordering and paging — everything a many-read takes but selection. */
export type ListFilterArgs<C, R extends RemainderBase, K extends keyof R & string> = {
  where?: ListWhere<C, R, K>
  orderBy?: ListOrderBy<C, R, K> | ListOrderBy<C, R, K>[]
  take?: number
  skip?: number
  cursor?: ListUniqueWhere<C, R, K>
  distinct?: (keyof StoredRow<C, R, K> & string) | (keyof StoredRow<C, R, K> & string)[]
}

export type FindUniqueArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & { where: ListUniqueWhere<C, R, K> }

export type FindManyArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> &
  ListFilterArgs<C, R, K>

export type CountArgs<C, R extends RemainderBase, K extends keyof R & string> = {
  where?: ListWhere<C, R, K>
  take?: number
  skip?: number
}

export type CreateArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & { data: CreateInput<C, R, K> }

export type CreateManyArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & { data: CreateInput<C, R, K>[] }

export type UpdateArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & { where: ListUniqueWhere<C, R, K>; data: UpdateInput<C, R, K> }

export type UpdateManyArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & { where?: ListWhere<C, R, K>; data: UpdateInput<C, R, K> }

export type DeleteArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & { where: ListUniqueWhere<C, R, K> }

export type GetArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<C, R, K>

/**
 * `get` exists on a singleton list and nowhere else. The key union is empty
 * for every other list, so the member simply is not there — a mapped type
 * rather than a conditional, so a generated interface can still extend the
 * whole {@link SecuredList}.
 */
type SingletonOpKey<R extends RemainderBase, K extends keyof R & string> = R[K] extends {
  singleton: true
}
  ? 'get'
  : never

type SingletonOps<C, R extends RemainderBase, K extends keyof R & string> = {
  [Op in SingletonOpKey<R, K>]: <
    S extends ListSelect<C, R, K> = never,
    I extends ListInclude<C, R, K> = never,
  >(args?: {
    select?: S
    include?: I
  }) => Promise<QueryResult<C, R, K, S, I> | null>
}

/**
 * One column's condition in a composed read's predicate: a bare value for
 * equality, or the closed Where vocabulary's scalar operators (ADR-0055).
 * Several operators on one column are ANDed. `equals: null` is `IS NULL` and
 * `not: null` is `IS NOT NULL`; `contains` is case-insensitive and matches its
 * value literally.
 */
export type ColumnCondition<V> =
  | V
  | {
      equals?: V
      not?: V
      in?: readonly V[]
      notIn?: readonly V[]
      lt?: V
      lte?: V
      gt?: V
      gte?: V
      contains?: string
    }

/**
 * One relation's condition. Every relation takes the same three quantifiers
 * regardless of cardinality: Prisma 8 lowers each to an `EXISTS`, and the
 * engine ANDs the related list's own `query` access inside it.
 */
type RelationPredicate<C, R extends RemainderBase, K extends keyof R & string, Rel> =
  RelationTarget<C, K, Rel> extends infer Target
    ? Target extends keyof R & string
      ? {
          some?: ListPredicate<C, R, Target>
          every?: ListPredicate<C, R, Target>
          none?: ListPredicate<C, R, Target>
        }
      : never
    : never

/** What `.where()` takes: the Where vocabulary over this list. */
export type ListPredicate<C, R extends RemainderBase, K extends keyof R & string> = {
  [F in keyof StoredRow<C, R, K>]?: ColumnCondition<StoredRow<C, R, K>[F]>
} & {
  [Rel in RelationKey<C, K>]?: RelationPredicate<C, R, K, Rel>
} & {
  AND?: ListPredicate<C, R, K> | readonly ListPredicate<C, R, K>[]
  OR?: readonly ListPredicate<C, R, K>[]
  NOT?: ListPredicate<C, R, K> | readonly ListPredicate<C, R, K>[]
}

/** What `.orderBy()` takes: the list's own scalar columns and a direction. */
export type ListSort<C, R extends RemainderBase, K extends keyof R & string> = {
  [F in keyof StoredRow<C, R, K>]?: 'asc' | 'desc'
}

/**
 * A composed read: an immutable value carrying the list, its predicates and
 * its sort. `where`/`orderBy` return a new value and enforce nothing; the
 * terminals resolve access, scope the query and materialise (ADR-0041,
 * ADR-0046).
 */
export type ListQuery<C, R extends RemainderBase, K extends keyof R & string> = {
  where: (predicate: ListPredicate<C, R, K>) => ListQuery<C, R, K>
  orderBy: (order: ListSort<C, R, K> | readonly ListSort<C, R, K>[]) => ListQuery<C, R, K>
  all: () => Promise<Row<C, R, K>[]>
  first: () => Promise<Row<C, R, K> | null>
}

type ListOps<C, R extends RemainderBase, K extends keyof R & string> = ListQuery<C, R, K> & {
  findUnique: <
    S extends ListSelect<C, R, K> = never,
    I extends ListInclude<C, R, K> = never,
  >(args: {
    where: ListUniqueWhere<C, R, K>
    select?: S
    include?: I
  }) => Promise<QueryResult<C, R, K, S, I> | null>

  findFirst: <S extends ListSelect<C, R, K> = never, I extends ListInclude<C, R, K> = never>(
    args?: ListFilterArgs<C, R, K> & { select?: S; include?: I },
  ) => Promise<QueryResult<C, R, K, S, I> | null>

  findMany: <S extends ListSelect<C, R, K> = never, I extends ListInclude<C, R, K> = never>(
    args?: ListFilterArgs<C, R, K> & { select?: S; include?: I },
  ) => Promise<QueryResult<C, R, K, S, I>[]>

  create: <S extends ListSelect<C, R, K> = never, I extends ListInclude<C, R, K> = never>(args: {
    data: CreateInput<C, R, K>
    select?: S
    include?: I
  }) => Promise<QueryResult<C, R, K, S, I> | null>

  createMany: <
    S extends ListSelect<C, R, K> = never,
    I extends ListInclude<C, R, K> = never,
  >(args: {
    data: CreateInput<C, R, K>[]
    select?: S
    include?: I
  }) => Promise<(QueryResult<C, R, K, S, I> | null)[]>

  update: <S extends ListSelect<C, R, K> = never, I extends ListInclude<C, R, K> = never>(args: {
    where: ListUniqueWhere<C, R, K>
    data: UpdateInput<C, R, K>
    select?: S
    include?: I
  }) => Promise<QueryResult<C, R, K, S, I> | null>

  updateMany: <
    S extends ListSelect<C, R, K> = never,
    I extends ListInclude<C, R, K> = never,
  >(args: {
    where?: ListWhere<C, R, K>
    data: UpdateInput<C, R, K>
    select?: S
    include?: I
  }) => Promise<(QueryResult<C, R, K, S, I> | null)[]>

  delete: <S extends ListSelect<C, R, K> = never, I extends ListInclude<C, R, K> = never>(args: {
    where: ListUniqueWhere<C, R, K>
    select?: S
    include?: I
  }) => Promise<QueryResult<C, R, K, S, I> | null>

  count: (args?: CountArgs<C, R, K>) => Promise<number>
}

/**
 * One list's access-controlled surface, keyed by the emitted contract and the
 * generated remainder. Denial is silent rather than thrown, so a caller checks
 * rather than catches: a single-record terminal returns `null`, a read of many
 * returns `[]`, and `createMany`/`updateMany` — which run one secured write per
 * item — return `null` in the position of each item that was denied.
 *
 * This is the type `.opensaas/types.ts` names per list:
 *
 * ```ts
 * export interface PostList extends SecuredList<Contract, Remainder, 'Post'> {}
 * ```
 */
export type SecuredList<C, R extends RemainderBase, K extends keyof R & string> = ListOps<C, R, K> &
  SingletonOps<C, R, K>

export type { ListId }
