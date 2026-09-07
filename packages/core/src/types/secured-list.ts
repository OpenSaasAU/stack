import type { Aggregations, CountReduction } from '../secured/aggregate.js'
import type { NearestMatch } from '../secured/read.js'
import type { NearestOptions } from '../secured/vocabulary.js'
import type {
  IsToOne,
  IsVectorColumn,
  ListId,
  RelationKey,
  RelationTarget,
  RemainderBase,
} from './contract.js'
import type { CreateInput, UpdateInput } from './inputs.js'
import type { RelationValue, Row, StoredRow, SystemFieldKey } from './rows.js'

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

/** The list an include's relation points at, when the remainder describes it. */
type IncludeTargetOf<C, R extends RemainderBase, K extends keyof R & string, Rel> =
  RelationTarget<C, K, Rel> extends infer Target
    ? Target extends keyof R & string
      ? Target
      : never
    : never

/**
 * What `.select()` may name: this list's own scalar and computed keys. A
 * relation is reached with `.include()` — naming one here is a
 * `RelationSelectError` at runtime, and a compile error now.
 */
export type SelectableKey<C, R extends RemainderBase, K extends keyof R & string> = Exclude<
  Extract<keyof Row<C, R, K>, string>,
  RelationKey<C, K>
>

/**
 * A projected row: exactly the keys `.select()` named, plus the list's own
 * system fields — which every read carries whatever it projected. Everything
 * the engine widened the query by is outside this type for the same reason it
 * is outside the result (ADR-0041).
 */
export type SelectedRow<
  C,
  R extends RemainderBase,
  K extends keyof R & string,
  F extends string,
> = Pick<Row<C, R, K>, Extract<F | SystemFieldKey, keyof Row<C, R, K>>>

/** A composed read's row: the projection when there is one, the whole row when there is not. */
type ComposedRow<
  C,
  R extends RemainderBase,
  K extends keyof R & string,
  Selected extends string,
> = [Selected] extends [never] ? Row<C, R, K> : SelectedRow<C, R, K, Selected>

/**
 * What one include adds to the row.
 *
 * Arity alone decides, off the contract's relation graph: a to-one is
 * `| null` whatever its foreign key's nullability, because the Access Filter
 * can scope it away for one session and not another and the result shape must
 * not vary (ADR-0058). Prisma's own `IncludeRelationValue` is never consulted.
 *
 * `Sel` is the refinement's own `.select()`, inferred at the include's call
 * site, so a projection is exact at every level exactly as it is at the root.
 */
type IncludedRelation<
  C,
  R extends RemainderBase,
  K extends keyof R & string,
  Rel,
  Sel extends string = never,
> = {
  [P in Rel & string]: IsToOne<C, K, Rel> extends true
    ? ComposedRow<C, R, IncludeTargetOf<C, R, K, Rel>, Sel> | null
    : ComposedRow<C, R, IncludeTargetOf<C, R, K, Rel>, Sel>[]
}

/**
 * A stored column of this list — what `distinct`, `distinctOn`, `cursor` and
 * `nearest` may name. Computed fields are excluded because they are stored
 * nowhere: the engine refuses one exactly as it refuses an undeclared key.
 */
export type StoredKey<C, R extends RemainderBase, K extends keyof R & string> = Extract<
  keyof StoredRow<C, R, K>,
  string
>

/**
 * The list's vector columns — what `nearest()` may search.
 *
 * `never` for a list that declares none, which makes the member uncallable
 * there rather than a runtime "is not a vector column".
 */
export type VectorKey<C, R extends RemainderBase, K extends keyof R & string> = {
  [F in StoredKey<C, R, K>]: IsVectorColumn<C, K, F> extends true ? F : never
}[StoredKey<C, R, K>]

/**
 * The relations that read as rows rather than as one row or null — the only
 * ones a `.count()` or `.combine()` can reduce (`ReducedToOneIncludeError`).
 */
type ToManyKey<C, K extends string> = {
  [Rel in RelationKey<C, K>]: IsToOne<C, K, Rel> extends true ? never : Rel
}[RelationKey<C, K>]

/** Where a `cursor` resumes from: values on the columns the read sorts by. */
export type ListCursor<C, R extends RemainderBase, K extends keyof R & string> = {
  [F in keyof StoredRow<C, R, K>]?: StoredRow<C, R, K>[F]
}

/**
 * A relation reduced to counts in place of its rows, as `.count()` and
 * `.combine()` produce it. `V` is what the relation then reads as on the
 * parent row: a number for a bare count, one number per key for a `combine`.
 *
 * `reduced` is phantom — the engine's reduction is `{ reduction: 'relation' }`
 * and nothing writes this member. It is declared rather than inferred from a
 * separate type parameter so a `combine`'s keys reach the include's row type
 * from the call site.
 */
export interface ListReduction<V> {
  readonly reduction: 'relation'
  readonly reduced: V
}

/**
 * What a terminal returns: the composed row with each include's own
 * contribution written over it.
 *
 * An include's key is REPLACED rather than intersected, because a reduced
 * relation reads as its count and `Row`'s own to-many member for that key is
 * an array — an intersection of the two describes no value. `Included`
 * defaults to `unknown`, which is the un-included case and leaves the row
 * untouched.
 */
type IncludedRow<Base, Included> = [unknown] extends [Included]
  ? Base
  : Omit<Base, keyof Included> & Included

/** What an include contributes to the row when its refinement reduced the relation. */
type ReducedRelation<Rel, Red> = {
  [P in Rel & string]: Red extends ListReduction<infer V> ? V : never
}

/**
 * A related read composed inside `.include()`. It carries no terminal: the
 * parent's terminal is the only thing that runs, and `limit`/`offset` here
 * page the related rows per parent row.
 *
 * `Reducible` says whether `.count()` and `.combine()` are still on it. It
 * starts `false` for a to-one relation, which reads as one row or null rather
 * than as rows to count (`ReducedToOneIncludeError`), and every member but
 * `where` turns it off, because a count honours `where()` alone
 * (`UnreducibleRefinementError`). Both refusals are therefore compile errors
 * rather than throws.
 */
export type ListRefinement<
  C,
  R extends RemainderBase,
  K extends keyof R & string,
  Selected extends string = never,
  Reducible extends boolean = true,
> = ComposableRefinement<C, R, K, Selected, Reducible> &
  (Reducible extends true ? Reducers : Record<never, never>)

type ComposableRefinement<
  C,
  R extends RemainderBase,
  K extends keyof R & string,
  Selected extends string,
  Reducible extends boolean,
> = {
  where: (predicate: ListPredicate<C, R, K>) => ListRefinement<C, R, K, Selected, Reducible>
  orderBy: (
    order: ListSort<C, R, K> | readonly ListSort<C, R, K>[],
  ) => ListRefinement<C, R, K, Selected, false>
  limit: (count: number) => ListRefinement<C, R, K, Selected, false>
  offset: (count: number) => ListRefinement<C, R, K, Selected, false>
  /**
   * Return exactly these of the related list's own fields. Replaces any
   * previous call rather than accumulating, and leaves relations this
   * refinement includes on the row.
   */
  select: <F extends SelectableKey<C, R, K>>(...fields: F[]) => ListRefinement<C, R, K, F, false>
  include: <Rel extends RelationKey<C, K>, Sel extends string = never>(
    name: Rel,
    refine?: (
      refinement: ListRefinement<
        C,
        R,
        IncludeTargetOf<C, R, K, Rel>,
        never,
        IsToOne<C, K, Rel> extends true ? false : true
      >,
    ) =>
      | ListRefinement<C, R, IncludeTargetOf<C, R, K, Rel>, Sel, boolean>
      | ListReduction<number>
      | ListReduction<Record<string, number>>,
  ) => ListRefinement<C, R, K, Selected, false>
}

/** What a refinement that has composed nothing but `where()` can still be reduced to. */
type Reducers = {
  /**
   * Reduce the related rows to how many of them this session may see, in
   * place of the rows themselves.
   */
  count: () => ListReduction<number>
  /**
   * Several independently scoped reductions over the same relation, one per
   * key. Each branch carries its own predicates and the related list's
   * `query` access, so one branch's scope never decides another's.
   */
  combine: <S extends Record<string, ListReduction<number>>>(
    spec: S,
  ) => ListReduction<{ [P in keyof S]: number }>
}

/**
 * A composed read: an immutable value carrying the list, its predicates, its
 * sort and the relations it reaches. `where`/`orderBy`/`include` return a new
 * value and enforce nothing; the terminals resolve access, scope the query
 * and materialise (ADR-0041, ADR-0046).
 *
 * `Included` accumulates one include's contribution to the row per call, so
 * the terminal's type is read off the call site rather than off a separate
 * argument object.
 */
export type ListQuery<
  C,
  R extends RemainderBase,
  K extends keyof R & string,
  Included = unknown,
  Selected extends string = never,
> = {
  where: (predicate: ListPredicate<C, R, K>) => ListQuery<C, R, K, Included, Selected>
  orderBy: (
    order: ListSort<C, R, K> | readonly ListSort<C, R, K>[],
  ) => ListQuery<C, R, K, Included, Selected>
  /**
   * Reach one hop into a relation, optionally refining the related read.
   *
   * A refinement that reduces the relation — `.count()` or `.combine()` —
   * makes the key read as the count rather than as rows, which is the first
   * signature below; anything else keeps the rows.
   */
  include: {
    <Rel extends ToManyKey<C, K>, Red extends ListReduction<unknown>>(
      name: Rel,
      refine: (refinement: ListRefinement<C, R, IncludeTargetOf<C, R, K, Rel>>) => Red,
    ): ListQuery<C, R, K, Included & ReducedRelation<Rel, Red>, Selected>
    <Rel extends RelationKey<C, K>, Sel extends string = never>(
      name: Rel,
      refine?: (
        refinement: ListRefinement<
          C,
          R,
          IncludeTargetOf<C, R, K, Rel>,
          never,
          IsToOne<C, K, Rel> extends true ? false : true
        >,
      ) => ListRefinement<C, R, IncludeTargetOf<C, R, K, Rel>, Sel, boolean>,
    ): ListQuery<C, R, K, Included & IncludedRelation<C, R, K, Rel, Sel>, Selected>
  }
  /**
   * Return exactly these of the list's own fields — including a computed one,
   * which is produced whether or not the columns it reads were named.
   *
   * Replaces any previous call rather than accumulating, and leaves relations
   * this read includes on the row. The engine widens the query behind it and
   * strips the difference back out, so neither the result nor this type
   * carries what it added (ADR-0041, ADR-0051).
   */
  select: <F extends SelectableKey<C, R, K>>(...fields: F[]) => ListQuery<C, R, K, Included, F>
  /** At most this many rows. Replaces any previous call; shapes `all()` alone. */
  limit: (count: number) => ListQuery<C, R, K, Included, Selected>
  /** Skip this many rows. Replaces any previous call; shapes `all()` alone. */
  offset: (count: number) => ListQuery<C, R, K, Included, Selected>
  /**
   * Collapse rows that agree on every named column. One `distinct` per read:
   * name every column in a single call.
   */
  distinct: (...fields: StoredKey<C, R, K>[]) => ListQuery<C, R, K, Included, Selected>
  /**
   * Keep the first row per distinct key, in the order `orderBy` established —
   * so it requires one that leads with these columns.
   */
  distinctOn: (...fields: StoredKey<C, R, K>[]) => ListQuery<C, R, K, Included, Selected>
  /**
   * Resume from a known position. Every key must name a column the active
   * `orderBy` sorts by, so a cursor cannot seek on an axis the read has no
   * order along — nor on one this session may not read.
   */
  cursor: (values: ListCursor<C, R, K>) => ListQuery<C, R, K, Included, Selected>
  all: () => Promise<IncludedRow<ComposedRow<C, R, K, Selected>, Included>[]>
  first: () => Promise<IncludedRow<ComposedRow<C, R, K, Selected>, Included> | null>
  /**
   * The rows nearest `vector` by the embedding field's own distance function,
   * scoped exactly as any other read. `[]` when the read is denied.
   *
   * `item` honours this read's projection and includes; the score sits beside
   * it rather than arriving as a field the list does not have (ADR-0045).
   *
   * `field` is one of this list's vector columns and nothing else — a list
   * that declares none has no callable `nearest`.
   */
  nearest: (
    field: VectorKey<C, R, K>,
    vector: readonly number[],
    options?: NearestOptions,
  ) => Promise<NearestMatch<IncludedRow<ComposedRow<C, R, K, Selected>, Included>>[]>
  /**
   * Reduce the read to named aggregates over the rows this session may see.
   * A denied read answers `0` under every key rather than throwing.
   */
  aggregate: <S extends Record<string, CountReduction>>(
    build: (aggregations: Aggregations) => S,
  ) => Promise<{ [P in keyof S]: number }>
}

/**
 * The composed read exists on a list and not on a singleton, mirroring
 * `populateDbDelegate`: a singleton gets `get` plus the CRUD delegate, and the
 * read wiring sits in the other branch. A `Pick` over a key union that is
 * empty for a singleton rather than a conditional over the whole type, for the
 * reason {@link SingletonOpKey} is one — a generated interface still extends
 * the whole {@link SecuredList}.
 */
type ComposedReadKey<C, R extends RemainderBase, K extends keyof R & string> = R[K] extends {
  singleton: true
}
  ? never
  : keyof ListQuery<C, R, K>

type ListOps<C, R extends RemainderBase, K extends keyof R & string> = Pick<
  ListQuery<C, R, K>,
  ComposedReadKey<C, R, K>
> & {
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
