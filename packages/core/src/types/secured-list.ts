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
  [Rel in RelationKey<C, K>]?:
    | boolean
    | SubArgs<C, R, RelationTarget<C, K, Rel> & keyof R & string>
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

type Arity<C, K extends string, Rel, Value> = IsToOne<C, K, Rel> extends true
  ? Value | null
  : Value[]

type SelectResult<C, R extends RemainderBase, K extends keyof R & string, S> = {
  -readonly [F in keyof S & keyof Row<C, R, K> as S[F] extends false | undefined
    ? never
    : F]-?: F extends RelationKey<C, K> ? SubResult<C, R, K, F, S[F]> : Row<C, R, K>[F]
}

type IncludeMembers<C, R extends RemainderBase, K extends keyof R & string, I> = {
  -readonly [Rel in keyof I & RelationKey<C, K> as I[Rel] extends false | undefined
    ? never
    : Rel]-?: SubResult<C, R, K, Rel, I[Rel]>
}

/**
 * A terminal's result, narrowed by what the caller asked for: `select` picks
 * exactly the named keys, `include` keeps the whole row and makes the named
 * relations present, and a bare read is the row's scalars and computed fields.
 */
export type QueryResult<C, R extends RemainderBase, K extends keyof R & string, A> = A extends {
  select: infer S
}
  ? SelectResult<C, R, K, S>
  : A extends { include: infer I }
    ? Row<C, R, K> & IncludeMembers<C, R, K, I>
    : Row<C, R, K>

// ── operation arguments ───────────────────────────────────────────────────

type Selection<C, R extends RemainderBase, K extends keyof R & string> = {
  select?: ListSelect<C, R, K>
  include?: ListInclude<C, R, K>
}

export type FindUniqueArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & {
  where: ListUniqueWhere<C, R, K>
}

export type FindManyArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & {
  where?: ListWhere<C, R, K>
  orderBy?: ListOrderBy<C, R, K> | ListOrderBy<C, R, K>[]
  take?: number
  skip?: number
  cursor?: ListUniqueWhere<C, R, K>
  distinct?: (keyof StoredRow<C, R, K> & string) | (keyof StoredRow<C, R, K> & string)[]
}

export type CountArgs<C, R extends RemainderBase, K extends keyof R & string> = {
  where?: ListWhere<C, R, K>
  take?: number
  skip?: number
}

export type CreateArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & {
  data: CreateInput<C, R, K>
}

export type CreateManyArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & {
  data: CreateInput<C, R, K>[]
}

export type UpdateArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & {
  where: ListUniqueWhere<C, R, K>
  data: UpdateInput<C, R, K>
}

export type UpdateManyArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & {
  where?: ListWhere<C, R, K>
  data: UpdateInput<C, R, K>
}

export type DeleteArgs<C, R extends RemainderBase, K extends keyof R & string> = Selection<
  C,
  R,
  K
> & {
  where: ListUniqueWhere<C, R, K>
}

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
  [Op in SingletonOpKey<R, K>]: <A extends GetArgs<C, R, K>>(
    args?: A,
  ) => Promise<QueryResult<C, R, K, A> | null>
}

type ListOps<C, R extends RemainderBase, K extends keyof R & string> = {
  findUnique: <A extends FindUniqueArgs<C, R, K>>(
    args: A,
  ) => Promise<QueryResult<C, R, K, A> | null>
  findFirst: <A extends FindManyArgs<C, R, K>>(args?: A) => Promise<QueryResult<C, R, K, A> | null>
  findMany: <A extends FindManyArgs<C, R, K>>(args?: A) => Promise<QueryResult<C, R, K, A>[]>
  create: <A extends CreateArgs<C, R, K>>(args: A) => Promise<QueryResult<C, R, K, A>>
  createMany: <A extends CreateManyArgs<C, R, K>>(args: A) => Promise<QueryResult<C, R, K, A>[]>
  update: <A extends UpdateArgs<C, R, K>>(args: A) => Promise<QueryResult<C, R, K, A> | null>
  updateMany: <A extends UpdateManyArgs<C, R, K>>(args: A) => Promise<QueryResult<C, R, K, A>[]>
  delete: <A extends DeleteArgs<C, R, K>>(args: A) => Promise<QueryResult<C, R, K, A> | null>
  count: (args?: CountArgs<C, R, K>) => Promise<number>
}

/**
 * One list's access-controlled surface, keyed by the emitted contract and the
 * generated remainder. Every operation returns `null` (single record) or `[]`
 * (multiple) when access is denied rather than throwing, so a caller checks
 * for `null` rather than catching.
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
