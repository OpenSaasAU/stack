import type {
  ColumnInputTypes,
  ForeignKeyColumn,
  HasColumnDefault,
  ListId,
  OwnedRelationKey,
  RelationsOf,
  RelationTarget,
  RemainderBase,
  SystemFilledColumn,
} from './contract.js'

/**
 * Every column a caller may write: the contract's input columns minus the ones
 * the system fills (the primary key, an ORM-side create generator, a database
 * function default). Foreign-key columns stay writable — `connect` lowers to
 * exactly such an assignment (ADR-0050).
 */
export type WritableColumn<C, K extends string> = Exclude<
  keyof ColumnInputTypes<C, K> & string,
  SystemFilledColumn<C, K>
>

type ColumnInput<
  C,
  R extends RemainderBase,
  K extends keyof R & string,
  F,
> = F extends keyof R[K]['input']
  ? R[K]['input'][F]
  : F extends keyof ColumnInputTypes<C, K>
    ? ColumnInputTypes<C, K>[F]
    : never

/**
 * A column required on create: non-nullable with no default of any kind.
 * A foreign-key column is never required here — the relation member carries
 * that obligation instead, so a caller is not asked for both spellings of the
 * same value.
 */
type RequiredCreateColumn<C, K extends string> = {
  [F in Exclude<WritableColumn<C, K>, ForeignKeyColumn<C, K>>]: null extends ColumnInputTypes<
    C,
    K
  >[F & keyof ColumnInputTypes<C, K>]
    ? never
    : HasColumnDefault<C, K, F> extends true
      ? never
      : F
}[Exclude<WritableColumn<C, K>, ForeignKeyColumn<C, K>>]

type ForeignKeyOf<C, K extends string, Rel> = Rel extends keyof RelationsOf<C, K>
  ? RelationsOf<C, K>[Rel] extends { readonly on: { readonly localFields: infer L } }
    ? L extends readonly (infer Col)[]
      ? Col
      : never
    : never
  : never

/**
 * A relation required on create: its foreign-key column is non-nullable and
 * carries no default, so there is no way to insert the row without naming the
 * related record (ADR-0058's read/write asymmetry — required to write,
 * nullable to read).
 */
type RequiredCreateRelation<C, K extends string> = {
  [Rel in OwnedRelationKey<C, K>]: null extends ColumnInputTypes<C, K>[ForeignKeyOf<C, K, Rel> &
    keyof ColumnInputTypes<C, K>]
    ? never
    : HasColumnDefault<C, K, ForeignKeyOf<C, K, Rel>> extends true
      ? never
      : Rel
}[OwnedRelationKey<C, K>]

/**
 * What a relation accepts on a write. `connect` is engine-owned sugar for a
 * scalar foreign-key assignment and is legal only on the side that owns the
 * column; clearing the edge is `null` on the same field, not a `disconnect`
 * (ADR-0050).
 */
type RelationInput<C, K extends string, Rel> = null extends ColumnInputTypes<C, K>[ForeignKeyOf<
  C,
  K,
  Rel
> &
  keyof ColumnInputTypes<C, K>]
  ? { connect: { id: ListId<C, RelationTarget<C, K, Rel>> } } | null
  : { connect: { id: ListId<C, RelationTarget<C, K, Rel>> } }

/**
 * The create payload for one list: scalars from the contract's input types
 * with the remainder's `input` overrides applied, `connect` on exactly the
 * relations the contract shows own a foreign key, and required members exactly
 * where the contract shows a non-nullable column with no default.
 */
export type CreateInput<C, R extends RemainderBase, K extends keyof R & string> = {
  [F in Extract<WritableColumn<C, K>, RequiredCreateColumn<C, K>>]: ColumnInput<C, R, K, F>
} & {
  [F in Exclude<WritableColumn<C, K>, RequiredCreateColumn<C, K>>]?: ColumnInput<C, R, K, F>
} & {
  [Rel in Extract<OwnedRelationKey<C, K>, RequiredCreateRelation<C, K>>]: RelationInput<C, K, Rel>
} & {
  [Rel in Exclude<OwnedRelationKey<C, K>, RequiredCreateRelation<C, K>>]?: RelationInput<C, K, Rel>
}

/**
 * The update payload for one list: every writable column and every
 * foreign-key-owning relation, all optional — an update is partial.
 */
export type UpdateInput<C, R extends RemainderBase, K extends keyof R & string> = {
  [F in WritableColumn<C, K>]?: ColumnInput<C, R, K, F>
} & {
  [Rel in OwnedRelationKey<C, K>]?: RelationInput<C, K, Rel>
}
