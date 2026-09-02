import type { Session, AccessContext, PrismaFilter } from './types.js'
import type { OpenSaasConfig, FieldConfig, ListConfig } from '../config/types.js'
import { checkAccess, getRelatedListConfig, resolveSyntheticReverseRelation } from './engine.js'
import { READ_INCLUDE_MAX_DEPTH } from './depth-limits.js'
import {
  AccessScopeDepthExceededError,
  RelationFilterAccessDeniedError,
  UndeclaredCountKeyError,
  UndeclaredIncludeKeyError,
} from './errors.js'
import {
  LOGICAL_OPERATORS,
  RELATION_QUANTIFIERS,
  resolveQueryField,
  validateQueryFieldReadAccess,
  validateQueryKeys,
  walkWhereReadAccess,
} from './query-validation.js'
import { isToManyRelationshipField, resolveCountAccessEntryForList } from './relationship-count.js'
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
 *
 * **A synthetic back-relation is a declared relationship wherever a caller
 * can name one (issue #1082).** A list-only `ref` (`ref: 'Other'`,
 * no target field) makes schema generation synthesize a back-relation on
 * `Other` (`from_<List>_<field>`) because the ORM requires an opposite field
 * there — but no list config declares it, so it is absent from `Other`'s own
 * `fieldConfigs`. An include key that fails the declared-relationship test is
 * resolved via `resolveSyntheticReverseRelation` before being treated as
 * unrecognised; a hit is scoped exactly like the declared relationship field
 * it stands for (its owning list's `query` access, folded `where`, nested
 * recursion, depth), always as a to-many relation — a list-only ref has one
 * construction site and no arity branch. A key that resolves to neither a
 * declared relationship nor a synthetic one is **rejected** (`_count` is
 * handled separately, scoped per named relation rather than resolved as a
 * single relationship key — see `buildAccessScopedCountSelect` below and
 * issue #1087), restoring this module's own denial rule for the one key
 * shape that used to fail open.
 */

/** The structured (object) form of a relation include entry — caller/fold-supplied or produced by this module. */
type IncludeEntryObject = {
  where?: PrismaFilter
  include?: Record<string, unknown>
  take?: number
  orderBy?: PrismaFilter | PrismaFilter[]
  skip?: number
}

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
 * issue #752), and a caller-supplied `orderBy`/`skip` (#851), are carried
 * through the same way: none of the three can ever widen the result past the
 * access `where` — they only narrow or reorder rows the access filter already
 * admits — so preserving them is access-neutral.
 */
function asEntryObject(value: unknown): IncludeEntryObject | null {
  if (!isPlainObject(value)) return null
  const { where, include, take, orderBy, skip } = value
  const entry: IncludeEntryObject = {}
  if (isPlainObject(where)) entry.where = where
  if (isPlainObject(include)) entry.include = include
  if (typeof take === 'number') entry.take = take
  if (isPlainObject(orderBy) || Array.isArray(orderBy)) {
    entry.orderBy = orderBy as PrismaFilter | PrismaFilter[]
  }
  if (typeof skip === 'number') entry.skip = skip
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
 * Which `_count.select` keys, at which nesting level of an `include`, were
 * denied outright by their related list's `query` access — omitted from the
 * `_count.select` sent to Prisma (issue #1087), so the row Prisma returns
 * either lacks the key entirely or lacks a `_count` object at all. Consumed
 * post-query by `filterReadableFields` (`field-visibility.ts`), which injects
 * `0` for each — a count is a session-relative value, and `0` is what "no
 * visible rows" means for it, never an absent key (mirroring the to-one
 * `null` injection this module already does for issue #974, though a denied
 * count needs no existence check: `0` requires no query at all).
 */
export type CountAccessDenialTree = {
  /** `_count.select` keys denied at THIS level. */
  keys: Set<string>
  /** Per-relation trees for relations present in the include for other reasons, whose own nested include may contain a further `_count`. */
  nested: Record<string, CountAccessDenialTree>
}

export function emptyCountAccessDenialTree(): CountAccessDenialTree {
  return { keys: new Set(), nested: {} }
}

function isCountAccessDenialTreeEmpty(tree: CountAccessDenialTree): boolean {
  return tree.keys.size === 0 && Object.keys(tree.nested).length === 0
}

/**
 * Normalize a caller's `_count` include value to the `_count.select` map it
 * names. `true` (Prisma's "count every relation" shorthand) expands to every
 * DECLARED to-many relationship on this list — matching
 * `buildRelationshipCountSelect`'s own scope (the admin list view), which
 * also does not enumerate synthetic back-relations for this form; a synthetic
 * key is still countable when the caller names it explicitly via `select`.
 * Returns `null` for a shape that requests nothing countable (`false`, or an
 * object with no usable `select`).
 */
function normalizeCountSelect(
  requestedValue: unknown,
  fieldConfigs: Record<string, FieldConfig>,
): Record<string, unknown> | null {
  if (requestedValue === true) {
    const expanded: Record<string, unknown> = {}
    for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
      if (isToManyRelationshipField(fieldConfig)) expanded[fieldName] = true
    }
    return expanded
  }
  if (isPlainObject(requestedValue) && isPlainObject(requestedValue.select)) {
    return requestedValue.select
  }
  return null
}

/**
 * Scope a caller-supplied `_count` include value by each named relation's own
 * `query` access — the `_count` counterpart to the rest of this module's
 * relation scoping (issue #1087, closing the one key `buildAccessScopedInclude`
 * used to allowlist through unscoped, #1082's "Out of scope").
 *
 * For each key in the caller's `_count.select` (or, for bare `_count: true`,
 * every declared to-many relation — see `normalizeCountSelect`):
 * - Not a declared to-many relationship and not a synthetic back-relation
 *   (#1082 — always genuinely countable) → THROWN as
 *   `UndeclaredCountKeyError`, matching `buildAccessScopedInclude`'s own
 *   rejection for the ordinary walk. A declared to-many relationship whose
 *   `ref` cannot be resolved is skipped instead, matching that same walk's
 *   handling of a config-level dangling ref (not a caller error).
 * - The related list's `query` access denies it (`=== false`) → omitted from
 *   the select sent to Prisma and added to the returned `deniedKeys`, so
 *   `filterReadableFields` can inject `0` post-query (a count is
 *   session-relative; denial doesn't mean "no such relation"). Checked BEFORE
 *   any caller-supplied nested `where` is validated — validating first would
 *   let a caller who cannot read a single row of the related list learn its
 *   field names and field-level read rules from a thrown `ValidationError`
 *   alone, reopening the exact oracle #915/ADR-0031 closed for a top-level
 *   predicate.
 * - Otherwise → the access filter (if any) is AND-combined with any
 *   caller-supplied nested `where` at that key — reusing `andWhere`, never
 *   replacing the caller's own condition (mirroring `buildAccessScopedInclude`
 *   itself) — and that `where` is key- and read-access-validated against the
 *   RELATED list via the same `validateQueryKeys`/`validateQueryFieldReadAccess`
 *   primitives `createFindMany` already runs on a top-level `where` (#912/#915),
 *   rather than a second, parallel predicate validator.
 */
async function buildAccessScopedCountSelect(
  requestedValue: unknown,
  fieldConfigs: Record<string, FieldConfig>,
  args: { session: Session | null; context: AccessContext },
  config: OpenSaasConfig,
  listKey: string,
): Promise<{ select: Record<string, unknown> | undefined; deniedKeys: Set<string> }> {
  const requestedSelect = normalizeCountSelect(requestedValue, fieldConfigs)
  const deniedKeys = new Set<string>()
  if (!requestedSelect) return { select: undefined, deniedKeys }

  const select: Record<string, unknown> = {}

  for (const [key, entryValue] of Object.entries(requestedSelect)) {
    // A caller can explicitly exclude a key from the `true`-expanded set the
    // same way Prisma's own `select` excludes a field.
    if (entryValue === false) continue

    const fieldConfig = fieldConfigs[key]
    const isDeclaredToMany = isToManyRelationshipField(fieldConfig)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
    let relatedConfig: { listName: string; listConfig: ListConfig<any> } | null = null
    if (isDeclaredToMany && fieldConfig && 'ref' in fieldConfig) {
      relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)
    }
    if (!relatedConfig && !isDeclaredToMany) {
      const synthetic = resolveSyntheticReverseRelation(key, listKey, config)
      if (synthetic) {
        relatedConfig = {
          listName: synthetic.sourceListName,
          listConfig: synthetic.sourceListConfig,
        }
      }
    }
    if (!relatedConfig) {
      // A declared to-many field whose `ref` didn't resolve is a config
      // issue, not a caller error — skip it exactly like the ordinary
      // include walk does for the same case.
      if (isDeclaredToMany) continue
      throw new UndeclaredCountKeyError(listKey, key)
    }

    const accessEntry = await resolveCountAccessEntryForList(relatedConfig.listConfig, args)

    // Denial is checked BEFORE the caller's nested `where` is validated —
    // mirroring `buildAccessScopedWhere`'s own ordering below. A fully denied
    // relation counts `0` no matter what `where` the caller supplied, so
    // validating it first would let a caller who cannot read a single row of
    // the related list learn its field names and field-level read rules from
    // a `ValidationError`'s message alone — the exact oracle #915/ADR-0031
    // closed for a top-level predicate, reopened here if this ran first.
    if (accessEntry.kind === 'denied') {
      deniedKeys.add(key)
      continue
    }

    const requestedWhere =
      isPlainObject(entryValue) && isPlainObject(entryValue.where)
        ? (entryValue.where as Record<string, unknown>)
        : undefined

    if (requestedWhere) {
      validateQueryKeys({
        where: requestedWhere,
        listConfig: relatedConfig.listConfig,
        listName: relatedConfig.listName,
        config,
        isSudo: false,
      })
      await validateQueryFieldReadAccess({
        where: requestedWhere,
        listConfig: relatedConfig.listConfig,
        listName: relatedConfig.listName,
        session: args.session,
        context: args.context,
        isSudo: false,
      })
    }

    const scopedWhere = andWhere(
      accessEntry.kind === 'scoped' ? accessEntry.where : undefined,
      requestedWhere,
    )
    select[key] = scopedWhere ? { where: scopedWhere } : true
  }

  return { select: Object.keys(select).length > 0 ? select : undefined, deniedKeys }
}

/**
 * Build the access-scoped `include` for exactly the relations a read
 * requested, recursing only into branches `requestedInclude` itself names.
 *
 * For each key in `requestedInclude`:
 * - A declared field that isn't a relationship (scalar, virtual, …) → access
 *   control does not govern it; passed through unchanged (a virtual key is
 *   stripped later by `stripVirtualFieldsFromInclude`, #628).
 * - Not declared at all → resolved via `resolveSyntheticReverseRelation`
 *   (the synthetic-back-relation case above); `_count` is scoped by
 *   `buildAccessScopedCountSelect` (issue #1087 — each named relation's own
 *   `query` access, exactly like any other relation this walk scopes; a
 *   denied one is recorded for `filterReadableFields` to inject `0` for,
 *   post-query, since Prisma cannot be asked for a guaranteed `0`); anything
 *   else throws `UndeclaredIncludeKeyError` rather than reaching the
 *   database unscoped.
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
): Promise<{
  include: Record<string, unknown>
  toOneAccessFilters: ToOneAccessFilterTree
  countDenials: CountAccessDenialTree
}> {
  const requestedKeys = Object.keys(requestedInclude)
  if (depth >= READ_INCLUDE_MAX_DEPTH && requestedKeys.length > 0) {
    throw new AccessScopeDepthExceededError(listKey, requestedKeys[0], depth)
  }

  const result: Record<string, unknown> = {}
  const toOneAccessFilters = emptyToOneAccessFilterTree()
  const countDenials = emptyCountAccessDenialTree()

  for (const [relationName, requestedValue] of Object.entries(requestedInclude)) {
    const fieldConfig = fieldConfigs[relationName]
    const isDeclaredRelationship =
      fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && !!fieldConfig.ref

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
    let relatedConfig: { listName: string; listConfig: ListConfig<any> } | null
    let isToOne: boolean

    if (isDeclaredRelationship) {
      relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)
      if (!relatedConfig) continue
      isToOne = isToOneRelationship(fieldConfig)
    } else if (fieldConfig) {
      // A declared field that is not a relationship — access control does
      // not govern it here; passed through unchanged.
      result[relationName] = requestedValue
      continue
    } else if (relationName === '_count') {
      const { select, deniedKeys } = await buildAccessScopedCountSelect(
        requestedValue,
        fieldConfigs,
        args,
        config,
        listKey,
      )
      if (select) result[relationName] = { select }
      if (deniedKeys.size > 0) countDenials.keys = deniedKeys
      continue
    } else {
      const synthetic = resolveSyntheticReverseRelation(relationName, listKey, config)
      if (!synthetic) {
        throw new UndeclaredIncludeKeyError(listKey, relationName)
      }
      relatedConfig = { listName: synthetic.sourceListName, listConfig: synthetic.sourceListConfig }
      // Always to-many — a list-only ref has one construction site and no
      // arity branch, and one-to-one is structurally impossible for it.
      isToOne = false
    }

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
    let nestedCountDenials: CountAccessDenialTree | undefined
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
      nestedCountDenials = nested.countDenials
    }

    const entry: IncludeEntryObject = {}
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
      if (requestedEntry?.orderBy !== undefined) entry.orderBy = requestedEntry.orderBy
      if (requestedEntry?.skip !== undefined) entry.skip = requestedEntry.skip
    }
    if (nestedInclude && Object.keys(nestedInclude).length > 0) entry.include = nestedInclude
    if (nestedToOneFilters && !isToOneAccessFilterTreeEmpty(nestedToOneFilters)) {
      toOneAccessFilters.nested[relationName] = nestedToOneFilters
    }
    if (nestedCountDenials && !isCountAccessDenialTreeEmpty(nestedCountDenials)) {
      countDenials.nested[relationName] = nestedCountDenials
    }

    result[relationName] = Object.keys(entry).length > 0 ? entry : true
  }

  return { include: result, toOneAccessFilters, countDenials }
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

  for (const [key, entry] of Object.entries(tree.filters)) {
    if (entry.kind === 'denied') {
      resolved.filters[key] = { kind: 'denied' }
      continue
    }

    const ids = new Set<string>()
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const value = (item as Record<string, unknown>)[key]
      if (value && typeof value === 'object' && 'id' in value) {
        ids.add(String((value as Record<string, unknown>).id))
      }
    }

    if (ids.size === 0) {
      resolved.filters[key] = { kind: 'visible', ids: new Set() }
      continue
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic model access by list name, mirroring the rest of the read pipeline
    const model = (args.context.prisma as any)[getDbKey(entry.relatedListName)]
    const visibleRows = await model.findMany({
      where: { AND: [entry.accessWhere, { id: { in: [...ids] } }] },
      select: { id: true },
    })
    const visibleIds = new Set<string>(
      Array.isArray(visibleRows) ? visibleRows.map((row: { id: unknown }) => String(row.id)) : [],
    )
    resolved.filters[key] = { kind: 'visible', ids: visibleIds }
  }

  for (const [key, nestedTree] of Object.entries(tree.nested)) {
    const nestedItems: unknown[] = []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const value = (item as Record<string, unknown>)[key]
      if (Array.isArray(value)) nestedItems.push(...value)
      else if (value && typeof value === 'object') nestedItems.push(value)
    }
    resolved.nested[key] = await resolveToOneAccessVisibility(nestedItems, nestedTree, args)
  }

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
