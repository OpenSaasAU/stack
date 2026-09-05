import type {
  ColumnOutputTypes,
  IsToOne,
  ListId,
  RelationKey,
  RelationTarget,
  RemainderBase,
} from './contract.js'

type StoredFields<C, R extends RemainderBase, K extends keyof R & string> = Omit<
  ColumnOutputTypes<C, K>,
  keyof R[K]['output']
> &
  R[K]['output']

/**
 * What a hook sees: the list's stored columns with the remainder's `output`
 * overrides applied and **no** computed fields. A hook runs before
 * `resolveOutput` and never sees a computed value (ADR-0027), so a type
 * carrying computed keys would be a lie the compiler could not catch.
 *
 * Relations are absent: a hook reaches one only by declaring it in `needs`,
 * which types it through {@link NeedsRow}.
 */
export type StoredRow<C, R extends RemainderBase, K extends keyof R & string> = {
  -readonly [F in keyof StoredFields<C, R, K>]: StoredFields<C, R, K>[F]
}

type RowFields<C, R extends RemainderBase, K extends keyof R & string> = StoredFields<C, R, K> &
  R[K]['computed']

/**
 * What a caller receives: the stored row plus the remainder's computed fields,
 * with each relation in the contract's graph present as an optional member —
 * a read with no `include` fetches scalars, not relations (ADR-0024), so the
 * key is only populated when the caller named it.
 *
 * A to-one relation is `| null` and a to-many `[]`, by arity alone (ADR-0058).
 * The foreign-key column keeps its own contract type beside the relation.
 */
export type Row<C, R extends RemainderBase, K extends keyof R & string> = {
  -readonly [F in keyof RowFields<C, R, K>]: RowFields<C, R, K>[F]
} & {
  [Rel in RelationKey<C, K>]?: RelationValue<C, R, K, Rel>
}

/**
 * A relation's read type: `Row<Target> | null` for a to-one, `Row<Target>[]`
 * for a to-many. An included row is our own `Row`, so it carries the target
 * list's computed fields and stored-field overrides exactly as a root row
 * does — Field Visibility runs at every level (ADR-0058).
 */
export type RelationValue<C, R extends RemainderBase, K extends keyof R & string, Rel> =
  RelationTarget<C, K, Rel> extends infer Target
    ? Target extends keyof R & string
      ? IsToOne<C, K, Rel> extends true
        ? Row<C, R, Target> | null
        : Row<C, R, Target>[]
      : never
    : never

/**
 * The system fields every list carries whatever it declares. `createdAt` and
 * `updatedAt` are only present when the list has them, so the union is
 * intersected with the stored row's own keys before it is used.
 */
export type SystemFieldKey = 'id' | 'createdAt' | 'updatedAt'

/**
 * What a `resolveOutput` hook's `item` is: exactly the field's declared
 * dependency set plus the list's actual system fields, and nothing else
 * (ADR-0051). Reading an undeclared column off this is a compile error, which
 * is the whole point — the runtime hands the hook a `Pick`, and a wider type
 * would hide the break rather than catch it.
 *
 * A declared relation resolves through {@link RelationValue}: a to-one is
 * `Row<Target> | null` because the Access Filter can scope the related row
 * away even though the declaration keeps the key present.
 *
 * @typeParam N - The declared dependency set, as a union of column and
 *   relation keys. `never` for a field that declares none.
 */
export type NeedsRow<
  C,
  R extends RemainderBase,
  K extends keyof R & string,
  N extends string,
> = Pick<StoredRow<C, R, K>, Extract<N | SystemFieldKey, keyof StoredRow<C, R, K>>> & {
  [Rel in Extract<N, RelationKey<C, K>>]: RelationValue<C, R, K, Rel>
}

export type { ListId }
