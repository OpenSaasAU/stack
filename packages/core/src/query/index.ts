import type { OrmOperationArgs } from '../access/types.js'

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

type UnwrapItem<T> = NonNullable<T> extends Array<infer U> ? NonNullable<U> : NonNullable<T>

// ─────────────────────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────────────────────

/**
 * A selector for a relationship field: either a {@link Fragment} directly
 * (shorthand), or `{ query, where?, orderBy?, take?, skip? }` to combine a
 * fragment with Prisma filter/ordering/pagination on the nested relationship.
 */
export type RelationSelector<TRelated extends Record<string, unknown>> =
  | Fragment<TRelated, FieldSelection<TRelated>>
  | {
      readonly query: Fragment<TRelated, FieldSelection<TRelated>>
      readonly where?: Record<string, unknown>
      readonly orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
      readonly take?: number
      readonly skip?: number
    }

/**
 * A field selection for model type `TItem`. Passing `true` for a
 * relationship field returns the raw Prisma value and loses type narrowing —
 * use a {@link Fragment} or {@link RelationSelector} to keep it typed.
 */
export type FieldSelection<T> = {
  readonly [K in keyof T]?: UnwrapItem<T[K]> extends Record<string, unknown>
    ? RelationSelector<UnwrapItem<T[K]>> | true
    : true
}

/**
 * A reusable, composable field-selection descriptor for model type `TItem`.
 * Create with {@link defineFragment}.
 */
export type Fragment<TItem, TFields extends FieldSelection<TItem> = FieldSelection<TItem>> = {
  readonly _type: 'fragment'
  readonly _fields: TFields
}

// ─────────────────────────────────────────────────────────────
// Internal type helpers
// ─────────────────────────────────────────────────────────────

/** @internal Returns `never` for scalar `true` selections, so they fall to the scalar branch in {@link SelectedFields}. */
type ExtractFragment<TSelector> =
  TSelector extends Fragment<infer TItem, infer TFields>
    ? Fragment<TItem, TFields>
    : TSelector extends { readonly query: Fragment<infer TItem, infer TFields> }
      ? Fragment<TItem, TFields>
      : never

/** @internal */
type SelectedFields<TItem, TFields extends FieldSelection<TItem>> = {
  [K in keyof TFields & keyof TItem]: [ExtractFragment<TFields[K]>] extends [never]
    ? // tuple wrapping avoids the vacuous `never extends T` pitfall
      TItem[K]
    : TItem[K] extends Array<unknown>
      ? ResultOf<ExtractFragment<TFields[K]>>[]
      : null extends TItem[K]
        ? ResultOf<ExtractFragment<TFields[K]>> | null
        : undefined extends TItem[K]
          ? ResultOf<ExtractFragment<TFields[K]>> | undefined
          : ResultOf<ExtractFragment<TFields[K]>>
}

// ─────────────────────────────────────────────────────────────
// Public type utilities
// ─────────────────────────────────────────────────────────────

/**
 * Infer the TypeScript result type from a {@link Fragment} — the shape
 * `runQuery`/`runQueryOne` return at runtime for that fragment.
 */
export type ResultOf<F> =
  F extends Fragment<infer TItem, infer TFields> ? SelectedFields<TItem, TFields> : never

/**
 * Arguments accepted by {@link runQuery}.
 */
export type QueryArgs = {
  /** Prisma where filter — the access control layer additionally scopes results. */
  where?: Record<string, unknown>
  orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
  take?: number
  skip?: number
}

/** Compatible with the full `AccessContext` produced by `getContext()`. */
export interface QueryRunnerContext {
  db: {
    [key: string]: {
      findMany: (args?: OrmOperationArgs) => Promise<unknown[]>
      findFirst: (args?: OrmOperationArgs) => Promise<unknown>
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Fragment factory
// ─────────────────────────────────────────────────────────────

/**
 * Create a type-safe, reusable fragment for a given model type. Curried so
 * TypeScript can infer the model type from the explicit type parameter and
 * the field selection from the argument.
 */
export function defineFragment<TItem>() {
  return function <TFields extends FieldSelection<TItem>>(
    fields: TFields,
  ): Fragment<TItem, TFields> {
    return { _type: 'fragment', _fields: fields }
  }
}

// ─────────────────────────────────────────────────────────────
// Runtime helpers
// ─────────────────────────────────────────────────────────────

/** @internal */
export function isFragment(value: unknown): value is Fragment<unknown, FieldSelection<unknown>> {
  return (
    value !== null &&
    typeof value === 'object' &&
    '_type' in value &&
    (value as { _type: unknown })._type === 'fragment'
  )
}

/**
 * Build the Prisma `include` map for a field selection's nested fragments.
 * Scalar fields (`true`) need no include entry — Prisma returns all scalar
 * columns by default; only relationship fields backed by a Fragment or
 * RelationSelector generate one (recursively).
 * @internal
 */
export function buildInclude(fields: FieldSelection<unknown>): Record<string, unknown> | undefined {
  const include: Record<string, unknown> = {}
  let hasIncludes = false

  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value === null || value === true || typeof value !== 'object') continue

    const val = value as Record<string, unknown>

    if (isFragment(val)) {
      hasIncludes = true
      const nestedInclude = buildInclude(val._fields as FieldSelection<unknown>)
      include[key] = nestedInclude ? { include: nestedInclude } : true
      continue
    }

    if ('query' in val && isFragment(val.query)) {
      hasIncludes = true
      const selector = val as {
        query: Fragment<unknown, FieldSelection<unknown>>
        where?: Record<string, unknown>
        orderBy?: unknown
        take?: number
        skip?: number
      }
      const nestedInclude = buildInclude(selector.query._fields as FieldSelection<unknown>)
      const includeEntry: Record<string, unknown> = {}
      if (selector.where !== undefined) includeEntry.where = selector.where
      if (selector.orderBy !== undefined) includeEntry.orderBy = selector.orderBy
      if (selector.take !== undefined) includeEntry.take = selector.take
      if (selector.skip !== undefined) includeEntry.skip = selector.skip
      if (nestedInclude) includeEntry.include = nestedInclude
      include[key] = Object.keys(includeEntry).length > 0 ? includeEntry : true
      continue
    }
  }

  return hasIncludes ? include : undefined
}

/**
 * A snapshot of which field names a fragment selects at one nesting level,
 * plus the same tree one level down for every relation selected via a nested
 * Fragment/RelationSelector. `fields: undefined` means "unrestricted" — every
 * field at this level is going to be returned, which is what a bare or
 * `include`-based read means for the whole tree (only a `query` fragment ever
 * produces a restricted scope, and only as deep as it names).
 *
 * Used to make computed-field evaluation (`filterReadableFields`) and
 * declared-dependency widening (`widenIncludeForDependencies`)
 * projection-aware (ADR-0027): a field not named by the scope at its level is
 * never computed and its `needs` are never fetched, because the read is never
 * going to return it.
 * @internal
 */
export type FieldSelectionScope = {
  readonly fields: ReadonlySet<string> | undefined
  readonly nested: Readonly<Record<string, FieldSelectionScope>>
}

/**
 * Build the `FieldSelectionScope` for one fragment's field selection,
 * recursing into nested Fragment/RelationSelector entries the same way
 * `buildInclude` does. A relation named with the bare `true` shorthand (no
 * narrower nested Fragment) gets no entry in `nested`, so a level reached
 * through it is treated as unrestricted — the caller asked for "everything"
 * there and gave no narrower shape to restrict it with.
 * @internal
 */
export function buildFieldSelectionScope(fields: FieldSelection<unknown>): FieldSelectionScope {
  const fieldNames = new Set(Object.keys(fields as Record<string, unknown>))
  const nested: Record<string, FieldSelectionScope> = {}

  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value === null || value === true || typeof value !== 'object') continue
    const val = value as Record<string, unknown>

    if (isFragment(val)) {
      nested[key] = buildFieldSelectionScope(val._fields as FieldSelection<unknown>)
      continue
    }

    if ('query' in val && isFragment(val.query)) {
      nested[key] = buildFieldSelectionScope(
        (val.query as Fragment<unknown, FieldSelection<unknown>>)
          ._fields as FieldSelection<unknown>,
      )
    }
  }

  return { fields: fieldNames, nested }
}

/**
 * Recursively pick only the fields requested by a fragment from a raw Prisma
 * result object, so the runtime shape matches `ResultOf<F>`.
 * @internal
 */
export function pickFields<TItem, TFields extends FieldSelection<TItem>>(
  item: TItem,
  fields: TFields,
): SelectedFields<TItem, TFields> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    const fieldValue = (item as Record<string, unknown>)[key]

    if (value === true) {
      result[key] = fieldValue
      continue
    }

    if (value === null || typeof value !== 'object') continue

    const val = value as Record<string, unknown>

    if (isFragment(val)) {
      if (Array.isArray(fieldValue)) {
        result[key] = fieldValue.map((elem) =>
          pickFields(elem as unknown, val._fields as FieldSelection<unknown>),
        )
      } else if (fieldValue === null || fieldValue === undefined) {
        result[key] = fieldValue
      } else {
        result[key] = pickFields(fieldValue as unknown, val._fields as FieldSelection<unknown>)
      }
      continue
    }

    if ('query' in val && isFragment(val.query)) {
      const nestedFrag = val.query as Fragment<unknown, FieldSelection<unknown>>
      if (Array.isArray(fieldValue)) {
        result[key] = fieldValue.map((elem) =>
          pickFields(elem as unknown, nestedFrag._fields as FieldSelection<unknown>),
        )
      } else if (fieldValue === null || fieldValue === undefined) {
        result[key] = fieldValue
      } else {
        result[key] = pickFields(
          fieldValue as unknown,
          nestedFrag._fields as FieldSelection<unknown>,
        )
      }
      continue
    }
  }

  return result as SelectedFields<TItem, TFields>
}

// ─────────────────────────────────────────────────────────────
// Standalone query runners
// ─────────────────────────────────────────────────────────────

/**
 * Execute a fragment-based query against a list, returning all matching
 * records shaped to the fragment's field selection. Calls
 * `context.db[listKey].findMany()` under the hood, so access control still
 * applies.
 */
export async function runQuery<TItem, TFields extends FieldSelection<TItem>>(
  context: QueryRunnerContext,
  listKey: string,
  fragment: Fragment<TItem, TFields>,
  args?: QueryArgs,
): Promise<SelectedFields<TItem, TFields>[]> {
  const include = buildInclude(fragment._fields as FieldSelection<unknown>)

  const findManyArgs: Record<string, unknown> = {}
  if (args?.where !== undefined) findManyArgs.where = args.where
  if (args?.orderBy !== undefined) findManyArgs.orderBy = args.orderBy
  if (args?.take !== undefined) findManyArgs.take = args.take
  if (args?.skip !== undefined) findManyArgs.skip = args.skip
  if (include) findManyArgs.include = include

  const results = await context.db[listKey].findMany(
    Object.keys(findManyArgs).length > 0 ? findManyArgs : undefined,
  )

  return results.map((item) => pickFields(item as TItem, fragment._fields)) as SelectedFields<
    TItem,
    TFields
  >[]
}

/**
 * Execute a fragment-based query that returns a single record (or `null`).
 * Calls `context.db[listKey].findFirst()` under the hood, so access control
 * still applies.
 */
export async function runQueryOne<TItem, TFields extends FieldSelection<TItem>>(
  context: QueryRunnerContext,
  listKey: string,
  fragment: Fragment<TItem, TFields>,
  where: Record<string, unknown>,
): Promise<SelectedFields<TItem, TFields> | null> {
  const include = buildInclude(fragment._fields as FieldSelection<unknown>)

  const findFirstArgs: Record<string, unknown> = { where }
  if (include) findFirstArgs.include = include

  const item = await context.db[listKey].findFirst(findFirstArgs)

  if (item === null || item === undefined) return null

  return pickFields(item as TItem, fragment._fields) as SelectedFields<TItem, TFields>
}
