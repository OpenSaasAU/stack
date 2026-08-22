import type { Session, AccessContext, PrismaFilter } from './types.js'
import type { OpenSaasConfig, FieldConfig, ListConfig } from '../config/types.js'
import { checkAccess, getRelatedListConfig } from './engine.js'
import { READ_INCLUDE_MAX_DEPTH } from './depth-limits.js'
import { AccessScopeDepthExceededError, RelationFilterAccessDeniedError } from './errors.js'
import {
  LOGICAL_OPERATORS,
  RELATION_QUANTIFIERS,
  resolveQueryField,
  walkWhereReadAccess,
} from './query-validation.js'
import { getDbKey } from '../lib/case-utils.js'

/**
 * Access Filter — phase 1 of the two-phase read (pre-query).
 *
 * This module scopes which rows and relationships the database is allowed to
 * return, before the query runs. It evaluates *operation-level* `query` access
 * on related lists and turns the results into a Prisma `include`/`where` clause,
 * so denied rows and relations never leave the database.
 *
 * Phase 2 (post-query field stripping + `resolveOutput` + virtual computation)
 * lives in `field-visibility.ts`. The two phases cannot be merged: virtual
 * fields are computed in JavaScript and post-query field access can depend on
 * the fetched row, neither of which is expressible in SQL. See
 * `docs/adr/0001-access-control-is-a-two-phase-read.md` and the access-control
 * glossary in `CONTEXT.md`.
 *
 * **Caller-directed (ADR-0026).** `buildAccessScopedInclude` walks only the
 * branches `requestedInclude` names — the caller's own `include`, a fragment
 * `query`'s projection, or `foldDeclaredDependencies`'s fold of a field's
 * `needs` (`declared-dependencies.ts`), all resolved before this module ever
 * runs. Naming a relation fetches that relation's own columns and stops
 * (the "One hop" rule, see `CONTEXT.md`); reaching further means the request
 * named a nested `include` there too. A relation nobody named never has its
 * list's `query` access evaluated at all — there is no separate "build the
 * whole tree, then reconcile against what was asked for" pass to walk it.
 *
 * **To-one relations are scoped after the query, not inside it (issue #974).**
 * Prisma accepts a nested `where` on an `include` entry only for a to-**many**
 * relation; the same shape on a to-**one** relation raises
 * `PrismaClientValidationError`. So for a to-one relation whose related
 * list's `query` access resolves to a filter, `buildAccessScopedInclude`
 * does NOT attach that filter as `where` — it fetches the row unscoped and
 * records the filter in the returned `toOneAccessFilters` tree instead.
 * `resolveToOneAccessVisibility` (below) turns that tree into the set of
 * related ids the session may actually see, via ONE batched `id IN (...)`
 * existence check per (relation, nesting level) across every row in the
 * read — never a per-row query, and never a hand-rolled evaluation of the
 * access filter (it is handed to Prisma exactly as `checkAccess` produced
 * it). `field-visibility.ts`'s `filterReadableFields` is where the result
 * actually becomes `null` for a row the check excludes — see its module doc.
 * A to-one relation whose related list's `query` access is `true` (no
 * filter) or `false` (denied outright) needs no existence check at all: the
 * former is left as `true` in `include`, unchanged from before; the latter
 * is recorded as `{ kind: 'denied' }`, and `field-visibility.ts` forces the
 * key to `null` without ever asking Prisma for it.
 */

/** The structured (object) form of a relation include entry — caller/fold-supplied or produced by this module. */
type IncludeEntryObject = { where?: PrismaFilter; include?: Record<string, unknown>; take?: number }

/** A plain object — excludes `null` and arrays, which `typeof x === 'object'` alone would admit. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrow an unknown include value to the structured object form (vs bare `true`
 * or any other primitive). Caller-supplied includes arrive untyped at the
 * runtime boundary: narrow to a plain object first, then validate each field's
 * own type before trusting it, rather than casting the whole value wholesale.
 *
 * A numeric `take` on a to-many relation include (a caller-supplied row bound,
 * issue #752) is carried through: it only ever NARROWS the fetched rows and can
 * never widen past the access `where`, so preserving it is access-neutral.
 */
function asEntryObject(value: unknown): IncludeEntryObject | null {
  if (!isPlainObject(value)) return null
  const { where, include, take } = value
  const entry: IncludeEntryObject = {}
  if (isPlainObject(where)) entry.where = where
  if (isPlainObject(include)) entry.include = include
  if (typeof take === 'number') entry.take = take
  return entry
}

/**
 * AND-combine an access `where` with a caller-supplied nested `where`.
 *
 * The access filter is authoritative: the caller's filter may only NARROW the
 * result further, never widen past what access permits. We therefore wrap both
 * in a Prisma `AND` so neither can override the other.
 */
function andWhere(
  accessWhere: PrismaFilter | undefined,
  callerWhere: PrismaFilter | undefined,
): PrismaFilter | undefined {
  if (accessWhere && callerWhere) {
    return { AND: [accessWhere, callerWhere] }
  }
  return accessWhere ?? callerWhere
}

/** One to-one relation's recorded access filter, or an outright denial — see the module doc's "To-one relations" section. */
export type ToOneAccessFilterEntry =
  { kind: 'scoped'; relatedListName: string; accessWhere: PrismaFilter } | { kind: 'denied' }

/**
 * Which to-one relations, at which nesting level of an `include`, need a
 * post-query existence check rather than a Prisma-side `where` — because
 * their related list's `query` access resolved to a filter (`kind: 'scoped'`)
 * or a denial (`kind: 'denied'`) and Prisma cannot express either as a nested
 * `where` on a to-one include. `resolveToOneAccessVisibility` consumes this
 * tree; `filterReadableFields` (`field-visibility.ts`) applies its result.
 */
export type ToOneAccessFilterTree = {
  /** To-one relation keys at THIS level needing a post-query check. */
  filters: Record<string, ToOneAccessFilterEntry>
  /** Per-key trees for relations present in the include for other reasons, whose own nested include may contain further to-one filters. */
  nested: Record<string, ToOneAccessFilterTree>
}

export function emptyToOneAccessFilterTree(): ToOneAccessFilterTree {
  return { filters: {}, nested: {} }
}

function isToOneAccessFilterTreeEmpty(tree: ToOneAccessFilterTree): boolean {
  return Object.keys(tree.filters).length === 0 && Object.keys(tree.nested).length === 0
}

/** Whether a relationship field is to-one (at most one related row) rather than to-many. */
function isToOneRelationship(fieldConfig: FieldConfig): boolean {
  return !('many' in fieldConfig && fieldConfig.many === true)
}

/**
 * Build the access-scoped `include` for exactly the relations a read
 * requested, recursing only into branches `requestedInclude` itself names.
 *
 * For each key in `requestedInclude`:
 * - Not a config-declared relationship → access control does not govern it;
 *   passed through unchanged (e.g. a fragment/caller key that isn't a
 *   relationship at all).
 * - A declared relationship whose related list's `query` access denies it
 *   (`=== false`) → dropped entirely, no matter what the request asked for
 *   nested beneath it (#566): the caller chooses *which* relations, access
 *   control chooses *whether* and *with what filter*. For a to-one relation
 *   this denial is also recorded in `toOneAccessFilters` (`kind: 'denied'`),
 *   so `filterReadableFields` can still surface an explicit `null` for it
 *   (issue #974) rather than an absent key.
 * - Otherwise, for a to-**many** relation → the access `where` is
 *   AND-combined with any caller-supplied nested `where` (never replaced —
 *   the other half of #566), and a caller-supplied `take` rides through
 *   unchanged (#752). For a to-**one** relation → the access filter (if any)
 *   is recorded in `toOneAccessFilters` instead of attached as `where`,
 *   because Prisma only accepts a nested `where` on a to-many include
 *   (issue #974) — the entry itself never carries a `where` for a to-one key.
 * - Either way — the "One hop" rule (ADR-0026) — nested relations are scoped
 *   ONLY if `requestedInclude` itself named a nested `include` here. A bare
 *   relation (or one with no nested `include`) fetches its own columns and
 *   stops: no recursive call, no access evaluation on anything beneath it.
 *
 * **Depth is a cost limit, not a cycle guard (ADR-0026).** A `requestedInclude`
 * is always a finite literal — the caller's own object, or
 * `foldDeclaredDependencies`'s already-cycle-guarded fold — so this recursion
 * cannot loop unboundedly on its own; nothing here walks the relationship
 * graph unprompted. `READ_INCLUDE_MAX_DEPTH` still bounds how deep a request
 * may reach, fail-closed per ADR-0022: a request naming anything at or past
 * the cap throws `AccessScopeDepthExceededError` rather than silently
 * returning less than what was asked for.
 */
export async function buildAccessScopedInclude(
  requestedInclude: Record<string, unknown>,
  fieldConfigs: Record<string, FieldConfig>,
  args: {
    session: Session | null
    context: AccessContext
  },
  config: OpenSaasConfig,
  listKey: string,
  depth: number = 0,
): Promise<{ include: Record<string, unknown>; toOneAccessFilters: ToOneAccessFilterTree }> {
  const requestedKeys = Object.keys(requestedInclude)
  if (depth >= READ_INCLUDE_MAX_DEPTH && requestedKeys.length > 0) {
    throw new AccessScopeDepthExceededError(listKey, requestedKeys[0], depth)
  }

  const result: Record<string, unknown> = {}
  const toOneAccessFilters = emptyToOneAccessFilterTree()

  for (const [relationName, requestedValue] of Object.entries(requestedInclude)) {
    const fieldConfig = fieldConfigs[relationName]
    const isDeclaredRelationship =
      fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && !!fieldConfig.ref

    if (!isDeclaredRelationship) {
      result[relationName] = requestedValue
      continue
    }

    const relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)
    if (!relatedConfig) continue

    const isToOne = isToOneRelationship(fieldConfig)

    const queryAccess = relatedConfig.listConfig.access?.operation?.query
    const accessResult = await checkAccess(queryAccess, {
      session: args.session,
      context: args.context,
    })

    if (accessResult === false) {
      if (isToOne) {
        toOneAccessFilters.filters[relationName] = { kind: 'denied' }
      }
      continue
    }

    const accessWhere = typeof accessResult === 'object' ? accessResult : undefined
    const requestedEntry = asEntryObject(requestedValue)

    let nestedInclude: Record<string, unknown> | undefined
    let nestedToOneFilters: ToOneAccessFilterTree | undefined
    if (requestedEntry?.include) {
      const nested = await buildAccessScopedInclude(
        requestedEntry.include,
        relatedConfig.listConfig.fields,
        args,
        config,
        relatedConfig.listName,
        depth + 1,
      )
      nestedInclude = nested.include
      nestedToOneFilters = nested.toOneAccessFilters
    }

    const entry: { where?: PrismaFilter; include?: Record<string, unknown>; take?: number } = {}
    if (isToOne) {
      if (accessWhere) {
        toOneAccessFilters.filters[relationName] = {
          kind: 'scoped',
          relatedListName: relatedConfig.listName,
          accessWhere,
        }
      }
    } else {
      const mergedWhere = andWhere(accessWhere, requestedEntry?.where)
      if (mergedWhere) entry.where = mergedWhere
      if (requestedEntry?.take !== undefined) entry.take = requestedEntry.take
    }
    if (nestedInclude && Object.keys(nestedInclude).length > 0) entry.include = nestedInclude
    if (nestedToOneFilters && !isToOneAccessFilterTreeEmpty(nestedToOneFilters)) {
      toOneAccessFilters.nested[relationName] = nestedToOneFilters
    }

    result[relationName] = Object.keys(entry).length > 0 ? entry : true
  }

  return { include: result, toOneAccessFilters }
}

/** One to-one relation's resolved post-query visibility — see `resolveToOneAccessVisibility`. */
export type ToOneVisibility = { kind: 'denied' } | { kind: 'visible'; ids: ReadonlySet<string> }

/** The resolved counterpart to {@link ToOneAccessFilterTree}, produced by `resolveToOneAccessVisibility`. */
export type ToOneAccessVisibilityTree = {
  filters: Record<string, ToOneVisibility>
  nested: Record<string, ToOneAccessVisibilityTree>
}

export function emptyToOneAccessVisibilityTree(): ToOneAccessVisibilityTree {
  return { filters: {}, nested: {} }
}

/**
 * Resolve a `ToOneAccessFilterTree` against the RAW rows Prisma already
 * fetched (unscoped for the flagged to-one relations — see
 * `buildAccessScopedInclude`) into the set of related ids the session may
 * actually see, one batched `id IN (...)` existence check per (relation,
 * nesting level) across every row in `items` — never once per row.
 *
 * For each `filters` entry at a level:
 * - `kind: 'denied'` → carried straight through; no query, nothing to check.
 * - `kind: 'scoped'` → every id present at this key across ALL of `items` is
 *   collected first (an empty set skips the query entirely — nothing to
 *   check), then ONE `findMany` through the RAW `prisma` client (not
 *   `context.db`, which would re-evaluate the same access-control function a
 *   second time) asks which of those ids also satisfy `accessWhere` — the
 *   exact `PrismaFilter` `checkAccess` already produced, handed to Prisma
 *   unmodified rather than interpreted by hand.
 *
 * Recurses into `nested` by flattening the related items reached through
 * each key across every row in `items` (a to-many hop contributes every one
 * of its rows; a to-one hop contributes its single row, if any) into the
 * next level's own `items` array, so a to-one relation nested arbitrarily
 * deep is still resolved with one batched query per node, not per parent row.
 */
export async function resolveToOneAccessVisibility(
  items: readonly unknown[],
  tree: ToOneAccessFilterTree,
  args: {
    session: Session | null
    context: AccessContext
  },
): Promise<ToOneAccessVisibilityTree> {
  const resolved = emptyToOneAccessVisibilityTree()

  // Every entry here is independent of every other — different relation key,
  // different query (or none) — so they run concurrently rather than one
  // await at a time.
  const filterWork = Object.entries(tree.filters).map(async ([key, entry]) => {
    if (entry.kind === 'denied') {
      resolved.filters[key] = { kind: 'denied' }
      return
    }

    // Keyed by the id's own string form for de-duplication, but the VALUE
    // preserved is the id exactly as fetched — a related list can carry a
    // non-string id (e.g. an `Int` singleton id, ADR-0004), and sending a
    // stringified id to Prisma for an `Int` column raises the same
    // `PrismaClientValidationError` class this fix exists to close.
    const idsById = new Map<string, unknown>()
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const value = (item as Record<string, unknown>)[key]
      if (value && typeof value === 'object' && 'id' in value) {
        const rawId = (value as Record<string, unknown>).id
        idsById.set(String(rawId), rawId)
      }
    }

    if (idsById.size === 0) {
      resolved.filters[key] = { kind: 'visible', ids: new Set() }
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic model access by list name, mirroring the rest of the read pipeline
    const model = (args.context.prisma as any)[getDbKey(entry.relatedListName)]
    const visibleRows = await model.findMany({
      where: { AND: [entry.accessWhere, { id: { in: [...idsById.values()] } }] },
      select: { id: true },
    })
    const visibleIds = new Set<string>(
      Array.isArray(visibleRows) ? visibleRows.map((row: { id: unknown }) => String(row.id)) : [],
    )
    resolved.filters[key] = { kind: 'visible', ids: visibleIds }
  })

  const nestedWork = Object.entries(tree.nested).map(async ([key, nestedTree]) => {
    const nestedItems: unknown[] = []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const value = (item as Record<string, unknown>)[key]
      if (Array.isArray(value)) nestedItems.push(...value)
      else if (value && typeof value === 'object') nestedItems.push(value)
    }
    resolved.nested[key] = await resolveToOneAccessVisibility(nestedItems, nestedTree, args)
  })

  await Promise.all([...filterWork, ...nestedWork])

  return resolved
}

/**
 * Scope every relation filter (`some`/`every`/`none`/`is`/`isNot`) nested in a
 * caller's `where` by the related list's own `query` access — the `where`
 * counterpart to `buildAccessScopedInclude` above, closing #916 (the
 * "unclosed half of ADR-0022"). `include` and `where` are fundamentally
 * different requests (which relations come back, vs. which parent rows
 * match), so this is a distinct function, but it shares every primitive that
 * matters: `checkAccess`/`getRelatedListConfig` (the same access-evaluation
 * calls `buildAccessScopedInclude` makes), `andWhere` (the same AND-fold), and
 * `resolveQueryField`/`LOGICAL_OPERATORS`/`RELATION_QUANTIFIERS`/
 * `walkWhereReadAccess` (the same shape-recognition and field-read check
 * `query-validation.ts` already uses for #912/#915) — there is no second,
 * parallel implementation of any of those decisions.
 *
 * For each relationship key found (at any depth — the walk recurses through
 * `AND`/`OR`/`NOT` and through every hop of a chain):
 * - Not a declared relationship, or the key #912 already rejected (this walk
 *   runs strictly after that check) → passed through unchanged.
 * - The related list's `query` access denies it (`=== false`) → THROWS
 *   `RelationFilterAccessDeniedError`. Unlike `buildAccessScopedInclude`'s
 *   silent drop, this is a loud failure: a `where` predicate has no neutral
 *   "not requested" outcome the way a missing `include` key does, so a
 *   silently-empty match would itself be a distinguishable signal (ADR-0022).
 * - Otherwise → the access filter (if any) is AND-combined into the relation
 *   quantifier's nested clause (never replacing the caller's own condition,
 *   mirroring `andWhere`'s include-side contract), keys inside that nested
 *   clause are checked against the RELATED list's field-level `read` access
 *   (`walkWhereReadAccess`, closing #915's stated gap for this path), and the
 *   walk recurses into the related list's own fields for a further hop.
 *
 * One quantifier is deliberately conservative rather than exactly precise:
 * folding the access filter into `every`'s nested clause with a plain AND
 * makes `every` require every related row to be BOTH access-visible AND
 * matching, not "every access-visible row matches" (the latter needs a
 * `NOT`/`OR` transform this does not attempt). The conservative version can
 * only reject a query that the precise version would allow — it never
 * widens what a caller can learn — so it is the safe direction to ship; a
 * caller can observe that an inaccessible related row exists (an `every`
 * that "should" pass instead fails), but never that row's field values,
 * which is the property this ticket exists to close.
 */
export async function buildAccessScopedWhere(
  where: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listName: string,
  config: OpenSaasConfig,
  args: {
    session: Session | null
    context: AccessContext
  },
): Promise<unknown> {
  if (where === null || typeof where !== 'object') return where

  if (Array.isArray(where)) {
    return Promise.all(
      where.map((entry) => buildAccessScopedWhere(entry, listConfig, listName, config, args)),
    )
  }

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (LOGICAL_OPERATORS.has(key)) {
      result[key] = await buildAccessScopedWhere(value, listConfig, listName, config, args)
      continue
    }

    const resolved = resolveQueryField(key, listConfig.fields)
    if (
      !resolved ||
      !resolved.isRelationship ||
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      result[key] = value
      continue
    }

    const related = getRelatedListConfig(resolved.fieldConfig.ref, config)
    if (!related) {
      result[key] = value
      continue
    }

    const queryAccess = related.listConfig.access?.operation?.query
    const accessResult = await checkAccess(queryAccess, {
      session: args.session,
      context: args.context,
    })

    if (accessResult === false) {
      throw new RelationFilterAccessDeniedError(listName, key, related.listName)
    }

    const accessWhere = typeof accessResult === 'object' ? accessResult : undefined
    const relationEntries = Object.entries(value as Record<string, unknown>)
    const hasQuantifier = relationEntries.some(([k]) => RELATION_QUANTIFIERS.has(k))

    if (hasQuantifier) {
      const nestedEntry: Record<string, unknown> = {}
      for (const [quantifier, quantifierValue] of relationEntries) {
        if (!RELATION_QUANTIFIERS.has(quantifier)) {
          nestedEntry[quantifier] = quantifierValue
          continue
        }
        await walkWhereReadAccess(quantifierValue, related.listConfig, related.listName, args)
        const scopedNested = await buildAccessScopedWhere(
          quantifierValue,
          related.listConfig,
          related.listName,
          config,
          args,
        )
        nestedEntry[quantifier] = accessWhere
          ? andWhere(accessWhere, scopedNested as PrismaFilter | undefined)
          : scopedNested
      }
      result[key] = nestedEntry
    } else {
      // Prisma's direct-nesting to-one form: the whole value IS the nested
      // WHERE clause, with no `is` wrapper. Only wrap it in `is` when there is
      // an access filter to fold in — an unwrapped value that needs no fold
      // (fully-allowed related list) is returned exactly as the caller wrote
      // it, so an already-permitted query is not perturbed by this pass.
      await walkWhereReadAccess(value, related.listConfig, related.listName, args)
      const scopedNested = await buildAccessScopedWhere(
        value,
        related.listConfig,
        related.listName,
        config,
        args,
      )
      result[key] = accessWhere
        ? { is: andWhere(accessWhere, scopedNested as PrismaFilter | undefined) }
        : scopedNested
    }
  }

  return result
}

/**
 * Remove keys that correspond to `virtual` fields from a Prisma `include`
 * object, recursing into nested relationship includes using the related
 * list's field configs.
 *
 * Virtual fields are computed in JavaScript (via `resolveOutput` in
 * `field-visibility.ts`) and have no database column. Naming one in `include`
 * type-checks — the generated `Include` type lists every field the config
 * declares — but Prisma throws `Unknown field '<name>' for include statement`
 * at runtime. This is applied as the final step on whatever `include` a read
 * op ends up with (fragment-built, access-controlled merge, or sudo
 * passthrough) so a virtual key never reaches the Prisma client, regardless
 * of which path produced it. The virtual value is still computed
 * unconditionally by `filterReadableFields`, so stripping the include key has
 * no effect on whether the value appears in the result (#628).
 */
export function stripVirtualFieldsFromInclude(
  include: Record<string, unknown> | undefined,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig,
): Record<string, unknown> | undefined {
  if (!include) return include

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(include)) {
    const fieldConfig = fieldConfigs[key]

    if (fieldConfig?.virtual) continue

    const isDeclaredRelationship =
      fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && !!fieldConfig.ref
    const entry = asEntryObject(value)

    if (isDeclaredRelationship && entry?.include) {
      const relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)
      if (relatedConfig) {
        const nestedInclude = stripVirtualFieldsFromInclude(
          entry.include,
          relatedConfig.listConfig.fields,
          config,
        )
        result[key] = { ...(value as Record<string, unknown>), include: nestedInclude }
        continue
      }
    }

    result[key] = value
  }

  return result
}
