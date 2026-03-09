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
 * A selector for a relationship field.
 *
 * Two forms are accepted:
 * 1. A `Fragment` directly (shorthand — no extra Prisma args on the nested query).
 * 2. An object `{ query, where?, orderBy?, take?, skip? }` to combine a fragment
 *    with Prisma filter/ordering/pagination applied to the nested relationship.
 *
 * @example Shorthand (most common)
 * ```ts
 * const postFrag = defineFragment<Post>()({
 *   id: true,
 *   author: authorFragment,   // shorthand
 * } as const)
 * ```
 *
 * @example With nested filtering
 * ```ts
 * const postFrag = defineFragment<Post>()({
 *   id: true,
 *   comments: {
 *     query:   commentFragment,
 *     where:   { approved: true },
 *     orderBy: { createdAt: 'desc' },
 *     take:    5,
 *   },
 * } as const)
 * ```
 *
 * @example Variables via factory function
 * ```ts
 * function makePostFragment(status: string) {
 *   return defineFragment<Post>()({
 *     id:      true,
 *     comments: { query: commentFragment, where: { status } },
 *   } as const)
 * }
 * type PostData = ResultOf<ReturnType<typeof makePostFragment>>
 * ```
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
 * A field selection for model type `TItem`.
 *
 * Each key maps to:
 * - `true`                — include the scalar/primitive field as-is
 * - A `Fragment`          — include a relationship and recurse (shorthand)
 * - A `RelationSelector`  — include a relationship with optional Prisma filter/ordering
 *
 * Only keys present in `TItem` are accepted. For relationship (object) fields
 * you may pass a Fragment, a RelationSelector, or `true` (returns the raw Prisma
 * value and loses type narrowing).
 *
 * @example
 * ```ts
 * const sel: FieldSelection<Post> = {
 *   id: true,
 *   title: true,
 *   author: authorFragment,
 *   comments: { query: commentFragment, where: { approved: true } },
 * }
 * ```
 */
export type FieldSelection<T> = {
  readonly [K in keyof T]?: UnwrapItem<T[K]> extends Record<string, unknown>
    ? RelationSelector<UnwrapItem<T[K]>> | true
    : true
}

/**
 * A reusable, composable field-selection descriptor for model type `TItem`.
 *
 * Create with {@link defineFragment}. Compose by referencing another Fragment
 * (or a {@link RelationSelector}) as the value for a relationship key.
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

// ─────────────────────────────────────────────────────────────
// Internal type helpers
// ─────────────────────────────────────────────────────────────

/**
 * @internal
 * Extract the Fragment from either a Fragment directly or a RelationSelector object.
 * Returns `never` for scalar `true` selections (so they fall to the scalar branch).
 */
type ExtractFragment<TSelector> =
  TSelector extends Fragment<infer TItem, infer TFields>
    ? Fragment<TItem, TFields>
    : TSelector extends { readonly query: Fragment<infer TItem, infer TFields> }
      ? Fragment<TItem, TFields>
      : never

/**
 * @internal
 * Map a FieldSelection over a model type, computing the picked output type.
 */
type SelectedFields<TItem, TFields extends FieldSelection<TItem>> = {
  [K in keyof TFields & keyof TItem]: [ExtractFragment<TFields[K]>] extends [never]
    ? // Scalar field (value is `true`) — tuple wrapping avoids the vacuous `never extends T` pitfall
      TItem[K]
    : // Relationship field — preserve array/null/undefined wrappers from the model
      TItem[K] extends Array<unknown>
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
 * Infer the TypeScript result type from a Fragment.
 *
 * Analogous to `gql.tada`'s `ResultOf` helper — given a fragment definition,
 * `ResultOf` tells you exactly what shape you will receive at runtime.
 *
 * - Scalar fields selected with `true` retain their original Prisma type.
 * - Relationship fields selected with a nested Fragment/RelationSelector are
 *   recursively narrowed.
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
export type ResultOf<F> =
  F extends Fragment<infer TItem, infer TFields> ? SelectedFields<TItem, TFields> : never

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
 * @example Basic usage
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
 * @example Compose fragments
 * ```ts
 * import type { Post } from '.prisma/client'
 *
 * export const postFragment = defineFragment<Post>()({
 *   id:      true,
 *   title:   true,
 *   author:  userFragment,
 * } as const)
 * ```
 *
 * @example Nested filtering with RelationSelector
 * ```ts
 * export const postWithApprovedComments = defineFragment<Post>()({
 *   id:    true,
 *   title: true,
 *   comments: {
 *     query:   commentFragment,
 *     where:   { approved: true },
 *     orderBy: { createdAt: 'desc' },
 *     take:    5,
 *   },
 * } as const)
 * ```
 *
 * @example Variables via factory function
 * ```ts
 * function makePostFragment(status: string) {
 *   return defineFragment<Post>()({
 *     id:      true,
 *     comments: { query: commentFragment, where: { status } },
 *   } as const)
 * }
 * type PostData = ResultOf<ReturnType<typeof makePostFragment>>
 *
 * const posts = await context.db.post.findMany({
 *   query: makePostFragment('approved'),
 *   where: { published: true },
 * })
 * ```
 */
export function defineFragment<TItem>() {
  return function <TFields extends FieldSelection<TItem>>(
    fields: TFields,
  ): Fragment<TItem, TFields> {
    return { _type: 'fragment', _fields: fields }
  }
}

// ─────────────────────────────────────────────────────────────
// Runtime helpers — exported for use in context/index.ts
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
 * Walk a field selection and build the Prisma `include` map needed to eagerly
 * load all nested relationship fragments/selectors.
 *
 * Scalar fields (`true`) do not require an include entry — Prisma returns all
 * scalar columns by default. Only relationship fields backed by a Fragment or
 * RelationSelector generate include entries (recursively).
 *
 * Exported for use in `context/index.ts` when the `query` parameter is present.
 * @internal
 */
export function buildInclude(fields: FieldSelection<unknown>): Record<string, unknown> | undefined {
  const include: Record<string, unknown> = {}
  let hasIncludes = false

  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value === null || value === true || typeof value !== 'object') continue

    const val = value as Record<string, unknown>

    // ── Shorthand: Fragment directly ──────────────────────────
    if (isFragment(val)) {
      hasIncludes = true
      const nestedInclude = buildInclude(val._fields as FieldSelection<unknown>)
      include[key] = nestedInclude ? { include: nestedInclude } : true
      continue
    }

    // ── RelationSelector: { query, where?, orderBy?, take?, skip? } ──
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
 * Recursively pick only the fields requested by a fragment from a raw Prisma
 * result object. This ensures the runtime shape exactly matches the type
 * produced by `ResultOf<F>`.
 *
 * Exported for use in `context/index.ts`.
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

    // ── Shorthand: Fragment directly ──────────────────────────
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

    // ── RelationSelector: { query, where?, ... } ──────────────
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
 * records shaped to the fragment's field selection.
 *
 * Under the hood this calls `context.db[listKey].findMany()`, so all access
 * control rules defined in your config are still enforced.
 *
 * **Tip:** You can also call `context.db.post.findMany({ query: fragment, ... })`
 * directly — both forms produce the same result.
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

  return results.map((item) => pickFields(item as TItem, fragment._fields)) as SelectedFields<
    TItem,
    TFields
  >[]
}

/**
 * Execute a fragment-based query that returns a single record (or `null`).
 *
 * Under the hood this calls `context.db[listKey].findFirst()`, so all access
 * control rules are still enforced.
 *
 * **Tip:** You can also call `context.db.post.findUnique({ where: { id }, query: fragment })`
 * directly.
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
