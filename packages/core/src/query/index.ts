import { getDbKey } from '../lib/case-utils.js'

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

/**
 * Unwrap the item type from a field type, stripping null, undefined, and
 * Array wrappers so we can constrain nested fragment shapes.
 *
 * Examples:
 *   User | null     → User
 *   User[]          → User
 *   (User | null)[] → User
 */
type UnwrapItem<T> = NonNullable<T> extends Array<infer U> ? NonNullable<U> : NonNullable<T>

// ─────────────────────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────────────────────

/**
 * A field selection for model type `TItem`.
 *
 * Each key maps to:
 * - `true`  — include the scalar/primitive field as-is
 * - A `Fragment` — include a relationship field and recurse into its fields
 *
 * Only keys present in `TItem` are accepted. For relationship (object) fields
 * you may pass either a typed Fragment or `true` (which returns the raw Prisma
 * value and loses narrowing).
 *
 * @example
 * ```ts
 * const sel: FieldSelection<Post> = {
 *   id: true,
 *   title: true,
 *   author: userFragment,  // Fragment<User, ...>
 * }
 * ```
 */
export type FieldSelection<T> = {
  readonly [K in keyof T]?: UnwrapItem<T[K]> extends Record<string, unknown>
    ? Fragment<UnwrapItem<T[K]>, FieldSelection<UnwrapItem<T[K]>>> | true
    : true
}

/**
 * A reusable, composable field-selection descriptor for model type `TItem`.
 *
 * Create with {@link defineFragment}. Compose by referencing another Fragment
 * as the value for a relationship key.
 *
 * @example
 * ```ts
 * const userFragment = defineFragment<User>()({ id: true, name: true } as const)
 * const postFragment = defineFragment<Post>()({
 *   id: true,
 *   title: true,
 *   author: userFragment,
 * } as const)
 * ```
 */
export type Fragment<TItem, TFields extends FieldSelection<TItem> = FieldSelection<TItem>> = {
  readonly _type: 'fragment'
  readonly _fields: TFields
}

/**
 * Infer the TypeScript result type from a Fragment.
 *
 * Analogous to `gql.tada`'s `ResultOf` helper — given a fragment definition,
 * `ResultOf` tells you exactly what shape you will receive at runtime.
 *
 * - Scalar fields selected with `true` retain their original Prisma type.
 * - Relationship fields selected with a nested Fragment are recursively narrowed.
 * - Nullability and array wrappers from the original model type are preserved.
 *
 * @example
 * ```ts
 * type UserData  = ResultOf<typeof userFragment>
 * // → { id: string; name: string }
 *
 * type PostData  = ResultOf<typeof postFragment>
 * // → { id: string; title: string; author: { id: string; name: string } | null }
 * ```
 */
export type ResultOf<F> = F extends Fragment<infer TItem, infer TFields>
  ? SelectedFields<TItem, TFields>
  : never

/**
 * @internal
 * Map a FieldSelection over a model type, computing the picked output type.
 */
type SelectedFields<TItem, TFields extends FieldSelection<TItem>> = {
  [K in keyof TFields & keyof TItem]: TFields[K] extends Fragment<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  >
    ? // Relationship field — preserve array/null/undefined wrappers from the model
      TItem[K] extends Array<unknown>
      ? ResultOf<TFields[K]>[]
      : null extends TItem[K]
        ? ResultOf<TFields[K]> | null
        : undefined extends TItem[K]
          ? ResultOf<TFields[K]> | undefined
          : ResultOf<TFields[K]>
    : // Scalar field (value is `true`)
      TItem[K]
}

/**
 * Arguments accepted by {@link runQuery}.
 */
export type QueryArgs = {
  /** Prisma where filter. The access control layer will additionally scope results. */
  where?: Record<string, unknown>
  /** Prisma orderBy clause. Pass a single object or an array for multi-column ordering. */
  orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
  /** Maximum number of records to return. */
  take?: number
  /** Number of records to skip (for pagination). */
  skip?: number
}

/**
 * Minimal context shape required by the query runners.
 * Compatible with the full `AccessContext` produced by `getContext()`.
 */
export interface QueryRunnerContext {
  db: {
    [key: string]: {
      findMany: (args?: unknown) => Promise<unknown[]>
      findFirst: (args?: unknown) => Promise<unknown>
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Fragment factory
// ─────────────────────────────────────────────────────────────

/**
 * Create a type-safe, reusable fragment for a given model type.
 *
 * The function is curried so that TypeScript can infer both the model type
 * (from the explicit type parameter) and the field selection (from the
 * argument), without requiring you to repeat yourself.
 *
 * @example
 * ```ts
 * import type { User } from '.prisma/client'
 * import { defineFragment } from '@opensaas/stack-core'
 *
 * export const userFragment = defineFragment<User>()({
 *   id:    true,
 *   name:  true,
 *   email: true,
 * } as const)
 * ```
 *
 * Fragments are composable — reference another fragment as the value for any
 * relationship key:
 *
 * ```ts
 * import type { Post } from '.prisma/client'
 *
 * export const postFragment = defineFragment<Post>()({
 *   id:      true,
 *   title:   true,
 *   author:  userFragment,   // nested fragment
 *   tags:    tagFragment,    // nested many fragment
 * } as const)
 * ```
 */
export function defineFragment<TItem>() {
  return function <TFields extends FieldSelection<TItem>>(fields: TFields): Fragment<TItem, TFields> {
    return { _type: 'fragment', _fields: fields }
  }
}

// ─────────────────────────────────────────────────────────────
// Runtime helpers (internal)
// ─────────────────────────────────────────────────────────────

/**
 * Walk a field selection and build the Prisma `include` map needed to eagerly
 * load all nested relationship fragments.
 *
 * Scalar fields (`true`) do not require an include entry — Prisma returns all
 * scalar columns by default. Only relationship fields backed by a Fragment
 * generate include entries (recursively).
 */
function buildInclude(
  fields: FieldSelection<unknown>,
): Record<string, unknown> | undefined {
  const include: Record<string, unknown> = {}
  let hasIncludes = false

  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      '_type' in value &&
      (value as Fragment<unknown>)._type === 'fragment'
    ) {
      hasIncludes = true
      const nestedFields = (value as Fragment<unknown, FieldSelection<unknown>>)._fields
      const nestedInclude = buildInclude(nestedFields)
      // If the nested fragment itself has no relationship includes, we only
      // need `true` (Prisma will load all scalars). If it does, we need to
      // nest `{ include: ... }`.
      include[key] = nestedInclude ? { include: nestedInclude } : true
    }
  }

  return hasIncludes ? include : undefined
}

/**
 * Recursively pick only the fields requested by a fragment from a raw Prisma
 * result object. This ensures the runtime shape exactly matches the type
 * produced by `ResultOf<F>`.
 */
function pickFields<TItem, TFields extends FieldSelection<TItem>>(
  item: TItem,
  fields: TFields,
): SelectedFields<TItem, TFields> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    const fieldValue = (item as Record<string, unknown>)[key]

    if (value === true) {
      result[key] = fieldValue
    } else if (
      value !== null &&
      typeof value === 'object' &&
      '_type' in value &&
      (value as Fragment<unknown>)._type === 'fragment'
    ) {
      const nestedFrag = value as Fragment<unknown, FieldSelection<unknown>>

      if (Array.isArray(fieldValue)) {
        result[key] = fieldValue.map((elem) =>
          pickFields(elem as unknown, nestedFrag._fields),
        )
      } else if (fieldValue === null || fieldValue === undefined) {
        result[key] = fieldValue
      } else {
        result[key] = pickFields(fieldValue as unknown, nestedFrag._fields)
      }
    }
  }

  return result as SelectedFields<TItem, TFields>
}

// ─────────────────────────────────────────────────────────────
// Query runners
// ─────────────────────────────────────────────────────────────

/**
 * Execute a fragment-based query against a list, returning all matching
 * records shaped to the fragment's field selection.
 *
 * Under the hood this calls `context.db[listKey].findMany()`, so all access
 * control rules defined in your config are still enforced.
 *
 * @param context - An `AccessContext` (or any object with a compatible `db`).
 * @param listKey - The PascalCase list name (e.g. `'Post'`, `'BlogPost'`).
 * @param fragment - A fragment created with {@link defineFragment}.
 * @param args     - Optional query arguments (where, orderBy, take, skip).
 * @returns        An array typed to exactly the fragment's field selection.
 *
 * @example
 * ```ts
 * const posts = await runQuery(context, 'Post', postFragment, {
 *   where:   { published: true },
 *   orderBy: { createdAt: 'desc' },
 *   take:    10,
 * })
 * // posts: Array<ResultOf<typeof postFragment>>
 * ```
 */
export async function runQuery<TItem, TFields extends FieldSelection<TItem>>(
  context: QueryRunnerContext,
  listKey: string,
  fragment: Fragment<TItem, TFields>,
  args?: QueryArgs,
): Promise<SelectedFields<TItem, TFields>[]> {
  const dbKey = getDbKey(listKey)
  const include = buildInclude(fragment._fields as FieldSelection<unknown>)

  const findManyArgs: Record<string, unknown> = {}
  if (args?.where !== undefined) findManyArgs.where = args.where
  if (args?.orderBy !== undefined) findManyArgs.orderBy = args.orderBy
  if (args?.take !== undefined) findManyArgs.take = args.take
  if (args?.skip !== undefined) findManyArgs.skip = args.skip
  if (include) findManyArgs.include = include

  const results = await context.db[dbKey].findMany(
    Object.keys(findManyArgs).length > 0 ? findManyArgs : undefined,
  )

  return results.map((item) =>
    pickFields(item as TItem, fragment._fields),
  ) as SelectedFields<TItem, TFields>[]
}

/**
 * Execute a fragment-based query that returns a single record (or `null`).
 *
 * Under the hood this calls `context.db[listKey].findFirst()`, so all access
 * control rules are still enforced.
 *
 * @param context - An `AccessContext` (or any object with a compatible `db`).
 * @param listKey - The PascalCase list name (e.g. `'Post'`).
 * @param fragment - A fragment created with {@link defineFragment}.
 * @param where    - A Prisma where clause to identify the record.
 * @returns        The matched record shaped to the fragment, or `null`.
 *
 * @example
 * ```ts
 * const post = await runQueryOne(context, 'Post', postFragment, { id: postId })
 * if (!post) return notFound()
 * // post: ResultOf<typeof postFragment>
 * ```
 */
export async function runQueryOne<TItem, TFields extends FieldSelection<TItem>>(
  context: QueryRunnerContext,
  listKey: string,
  fragment: Fragment<TItem, TFields>,
  where: Record<string, unknown>,
): Promise<SelectedFields<TItem, TFields> | null> {
  const dbKey = getDbKey(listKey)
  const include = buildInclude(fragment._fields as FieldSelection<unknown>)

  const findFirstArgs: Record<string, unknown> = { where }
  if (include) findFirstArgs.include = include

  const item = await context.db[dbKey].findFirst(findFirstArgs)

  if (item === null || item === undefined) return null

  return pickFields(item as TItem, fragment._fields) as SelectedFields<TItem, TFields>
}
