import type {
  ExtractFieldInputTypes,
  ExtractFieldOutputTypes,
} from '@prisma/orm-postgres/family-contract/types'

/**
 * The contract remainder for one list — the facts about it that the emitted
 * Contract artifacts cannot carry, which `.opensaas/types.ts` authors and
 * every generic in this module reads alongside the contract (ADR-0052).
 *
 * - `computed` — a virtual field's output type, keyed by field name. A virtual
 *   field has no column, so the contract has no type for it.
 * - `output` — a stored field whose TypeScript read face differs from its
 *   codec's (`password` reads as `HashedPassword` over a text column).
 * - `input` — the same asymmetry on the write side (`calendarDay` writes as
 *   `string`).
 * - `needs` — each computed field's declared dependency set, as a union of the
 *   column and relation keys it reads (ADR-0051).
 * - `singleton` — `true` on a list declared `isSingleton`. The contract sees an
 *   integer primary key with a default; singleton-ness is a config fact.
 */
export type ListRemainder = {
  computed: Record<string, unknown>
  output: Record<string, unknown>
  input: Record<string, unknown>
  needs: Record<string, string>
  singleton?: boolean
}

/**
 * The generated `Remainder` map — one {@link ListRemainder} per list key.
 * Every generic in this module is keyed by an emitted `Contract` and a type
 * satisfying this shape.
 */
export type RemainderBase = Record<string, ListRemainder>

type NamespacesOf<C> = C extends { readonly domain: { readonly namespaces: infer N } } ? N : never

/**
 * The contract's entry for model `K`, found across every namespace. A list
 * outside `public` (`db.schema`) is reached by the same lookup as one inside
 * it, so no generic here takes a namespace.
 */
type ModelEntry<C, K extends string> = {
  [NS in keyof NamespacesOf<C>]: NamespacesOf<C>[NS] extends { readonly models: infer M }
    ? K extends keyof M
      ? M[K]
      : never
    : never
}[keyof NamespacesOf<C>]

/** The contract's resolved read type per column, nullability already applied. */
export type ColumnOutputTypes<C, K extends string> = {
  [NS in keyof ExtractFieldOutputTypes<C>]: K extends keyof ExtractFieldOutputTypes<C>[NS]
    ? ExtractFieldOutputTypes<C>[NS][K]
    : never
}[keyof ExtractFieldOutputTypes<C>]

/** The contract's resolved write type per column, nullability already applied. */
export type ColumnInputTypes<C, K extends string> = {
  [NS in keyof ExtractFieldInputTypes<C>]: K extends keyof ExtractFieldInputTypes<C>[NS]
    ? ExtractFieldInputTypes<C>[NS][K]
    : never
}[keyof ExtractFieldInputTypes<C>]

export type RelationsOf<C, K extends string> =
  ModelEntry<C, K> extends { readonly relations: infer R } ? R : never

/** Every relation the contract's graph hangs off list `K`. */
export type RelationKey<C, K extends string> = keyof RelationsOf<C, K> & string

export type RelationTarget<C, K extends string, Rel> = Rel extends keyof RelationsOf<C, K>
  ? RelationsOf<C, K>[Rel] extends { readonly to: { readonly model: infer M } }
    ? M & string
    : never
  : never

type Cardinality<C, K extends string, Rel> = Rel extends keyof RelationsOf<C, K>
  ? RelationsOf<C, K>[Rel] extends { readonly cardinality: infer Card }
    ? Card
    : never
  : never

/**
 * Arity, and nothing else, decides a relation's read type (ADR-0058): `N:1`
 * and `1:1` are to-one, everything else to-many. The foreign key's own
 * nullability is never consulted.
 */
export type IsToOne<C, K extends string, Rel> = Cardinality<C, K, Rel> extends 'N:1' | '1:1'
  ? true
  : false

/**
 * A relation whose foreign key this side owns. Prisma spells that `N:1` on
 * both a many-to-one and the owning half of a one-to-one (ADR-0064), so this
 * is also the set a write may `connect`.
 */
export type OwnedRelationKey<C, K extends string> = {
  [Rel in RelationKey<C, K>]: Cardinality<C, K, Rel> extends 'N:1' ? Rel : never
}[RelationKey<C, K>]

/** The foreign-key columns the relations above sit on. */
export type ForeignKeyColumn<C, K extends string> = {
  [Rel in RelationKey<C, K>]: Cardinality<C, K, Rel> extends 'N:1'
    ? RelationsOf<C, K>[Rel] extends { readonly on: { readonly localFields: infer L } }
      ? L extends readonly (infer Col)[]
        ? Col
        : never
      : never
    : never
}[RelationKey<C, K>] &
  string

// ── storage lookups, for column defaults ──────────────────────────────────

type StorageOf<C, K extends string> =
  ModelEntry<C, K> extends { readonly storage: infer S } ? S : never

type TableOf<C, K extends string> = StorageOf<C, K> extends { readonly table: infer T } ? T : never

type NamespaceIdOf<C, K extends string> =
  StorageOf<C, K> extends { readonly namespaceId: infer N } ? N : never

type PhysicalColumn<C, K extends string, F> =
  StorageOf<C, K> extends { readonly fields: infer FS }
    ? F extends keyof FS
      ? FS[F] extends { readonly column: infer Col }
        ? Col
        : never
      : never
    : never

type TableColumns<C, K extends string> =
  C extends { readonly storage: { readonly namespaces: infer NSs } }
    ? NamespaceIdOf<C, K> extends keyof NSs
      ? NSs[NamespaceIdOf<C, K>] extends { readonly entries: { readonly table: infer T } }
        ? TableOf<C, K> extends keyof T
          ? T[TableOf<C, K>] extends { columns: infer Cols }
            ? Cols
            : never
          : never
        : never
      : never
    : never

type ColumnEntry<C, K extends string, F> =
  PhysicalColumn<C, K, F> extends keyof TableColumns<C, K>
    ? TableColumns<C, K>[PhysicalColumn<C, K, F>]
    : never

/** Whether the column carries any database default — literal or function. */
export type HasColumnDefault<C, K extends string, F> =
  ColumnEntry<C, K, F> extends { readonly default: unknown } ? true : false

/** Whether the column's database default is an expression the database runs. */
type HasFunctionDefault<C, K extends string, F> =
  ColumnEntry<C, K, F> extends { readonly default: { readonly kind: 'function' } } ? true : false

type MutationDefaults<C> = C extends {
  readonly execution: { readonly mutations: { readonly defaults: infer D } }
}
  ? D extends readonly unknown[]
    ? D[number]
    : never
  : never

/**
 * Whether the ORM fills this column on create from an application-side
 * generator (`uuidv7`, `timestampNow`) rather than the caller.
 */
type HasCreateGenerator<C, K extends string, F> = [
  Extract<
    MutationDefaults<C>,
    { readonly ref: { readonly table: TableOf<C, K>; readonly column: PhysicalColumn<C, K, F> } }
  >,
] extends [never]
  ? false
  : true

/**
 * A column the system fills, which therefore never appears on a write input:
 * the primary key, a column with an ORM-side create generator, and a column
 * whose database default is an expression (`createdAt`'s `now()`).
 */
export type SystemFilledColumn<C, K extends string> = {
  [F in keyof ColumnInputTypes<C, K> & string]: F extends 'id'
    ? F
    : HasCreateGenerator<C, K, F> extends true
      ? F
      : HasFunctionDefault<C, K, F> extends true
        ? F
        : never
}[keyof ColumnInputTypes<C, K> & string]

/**
 * The list's primary-key type, read from the contract rather than assumed —
 * a `uuid7` list is `string` and an `int autoincrement` or singleton list is
 * `number`, with no stack-level union (PRD user story 22).
 */
export type ListId<C, K extends string> = 'id' extends keyof ColumnOutputTypes<C, K>
  ? ColumnOutputTypes<C, K>['id']
  : never
