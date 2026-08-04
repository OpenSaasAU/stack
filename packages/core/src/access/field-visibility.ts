import type { Session, AccessContext } from './types.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'
import { getRelatedListConfig } from './engine.js'
import { checkFieldAccess } from './field-access.js'
import { RESOLVE_CHAIN_MAX_LENGTH } from './depth-limits.js'
import { ResolveOutputCycleError } from './errors.js'
import type { DeclaredOnlyTree } from './declared-dependencies.js'
import { emptyDeclaredOnlyTree } from './declared-dependencies.js'
import type { FieldSelectionScope } from '../query/index.js'
// NOTE: `context/index.ts` imports `filterReadableFields` from this module
// (via the `access/index.ts` barrel) — this is an intentional cyclic
// dependency, the same shape and for the same reason as the one documented in
// `context/write-pipeline.ts`. `buildDbDelegate` is only INVOKED when a
// `resolveOutput` hook actually runs (never during module evaluation), so by
// the time it runs the export is fully initialised.
import { buildDbDelegate } from '../context/index.js'

/**
 * Field Visibility — phase 2 of the two-phase read (post-query).
 *
 * This module runs after the database query against the returned rows. It
 * strips fields the session cannot read (via the canonical `checkFieldAccess`
 * evaluator in `field-access.ts`), runs `resolveOutput` hooks, and computes
 * virtual fields. None of this can move into phase 1: virtual fields are
 * computed in JavaScript and field access can depend on the fetched row.
 *
 * A computed field — any field carrying a `resolveOutput` hook, virtual or
 * not — is produced only where the read is going to return it (ADR-0027). A
 * fragment `query`'s own field selection is the only thing that restricts a
 * level this way; a bare or `include`-based read, and any relation reached
 * purely to satisfy a `needs` declaration, still compute every field, as
 * before. A field the read is not going to return does no work at all —
 * neither its read-access evaluation nor its hook.
 *
 * Phase 1 (pre-query row/relation scoping) lives in `access-filter.ts`. See
 * `docs/adr/0001-access-control-is-a-two-phase-read.md` and the access-control
 * glossary in `CONTEXT.md`.
 */

/**
 * Runtime type for resolveOutput hooks
 * Used when we need to call hooks generically without knowing the specific field type
 * Supports both sync and async implementations
 */
type ResolveOutputHookRuntime = (args: {
  operation: 'query'
  value: unknown
  item: Record<string, unknown>
  listKey: string
  fieldName: string
  context: AccessContext
}) => unknown | Promise<unknown>

type FieldVisibilityArgs = {
  session: Session | null
  context: AccessContext & { _isSudo?: boolean }
}

/**
 * Derive the context passed to a single `resolveOutput` hook invocation: a
 * NEW context object whose `_resolveOutputChain` extends the caller's chain
 * with this hook's own `(list, field)` link. The chain is never mutated in
 * place — this is what lets concurrent hook invocations (e.g. sibling rows in
 * a to-many relation, filtered via `Promise.all`) each see their own chain
 * rather than racing on one shared value (ADR-0023).
 *
 * A plain `{ ...context, _resolveOutputChain }` spread is not enough on its
 * own: `context.db`'s operations capture their `context` at construction
 * (see `populateDbDelegate`), so a hook that calls `context.db.x.findMany(…)`
 * would otherwise reach the ORIGINAL closures — bound to the ORIGINAL
 * context — and its read would silently fall back to the un-extended chain,
 * defeating the cycle guard entirely. Rebuilding `db` via `buildDbDelegate`
 * against the derived context is what makes a hook-issued read's own nested
 * hooks actually observe the extended chain.
 *
 * `config` is required to rebuild `db`; callers that cannot supply one (e.g. a
 * narrow unit test exercising field access in isolation) still get a correct
 * chain for THIS hook's own cycle/cap check, but a read that hook issues
 * would not carry the chain any further — those callers are not exercising
 * the read pipeline, so there is nothing for it to reach.
 */
function deriveResolveOutputContext(
  context: AccessContext & { _isSudo?: boolean },
  link: { listKey: string; fieldKey: string },
  config: OpenSaasConfig | undefined,
): AccessContext & { _isSudo?: boolean } {
  const derived: AccessContext & { _isSudo?: boolean } = {
    ...context,
    _resolveOutputChain: [...context._resolveOutputChain, link],
  }
  if (config) {
    derived.db = buildDbDelegate(config, context.prisma, derived)
  }
  return derived
}

/**
 * The core Field Visibility step for a single field: check read access and, if
 * granted, produce the output value by running any `resolveOutput` hook.
 *
 * This is the single place the "check read access → skip if denied →
 * resolveOutput" sequence lives. Both the regular-field branch and the
 * virtual-field branch of `filterReadableFields` call it, so the sequence is
 * never duplicated. Returns `{ readable: false }` when the field must be omitted
 * from the result.
 *
 * `accessItem` is the row used to evaluate field access; `hookItem` is the
 * object passed to the hook as `item`. For a stored field, both are
 * `workingItem` (the row's own stored/fetched columns). For a virtual field,
 * `hookItem` is `computedFieldItem` instead — the same stored columns with
 * every skipped-or-denied key removed — so it never sees another computed
 * field's resolved value (ADR-0027).
 */
async function resolveReadableFieldValue(params: {
  fieldConfig: FieldConfig | undefined
  fieldName: string
  value: unknown
  accessItem: Record<string, unknown>
  hookItem: Record<string, unknown>
  listKey: string | undefined
  args: FieldVisibilityArgs
  config: OpenSaasConfig | undefined
}): Promise<{ readable: false } | { readable: true; value: unknown }> {
  const { fieldConfig, fieldName, value, accessItem, hookItem, listKey, args, config } = params

  // Check field access (checkFieldAccess already handles sudo mode)
  const canRead = await checkFieldAccess(fieldConfig?.access, 'read', {
    ...args,
    item: accessItem,
  })

  if (!canRead) {
    return { readable: false }
  }

  // Apply resolveOutput hook if present
  if (fieldConfig?.hooks?.resolveOutput && listKey) {
    // Cast to runtime type for generic execution
    // At runtime, the hook will receive the correct value type for the field
    const hook = fieldConfig.hooks.resolveOutput as unknown as ResolveOutputHookRuntime
    const link = { listKey, fieldKey: fieldName }
    const chain = args.context._resolveOutputChain

    // Cycle guard: a hook that would re-enter a (list, field) pair already on
    // its own chain cannot terminate — refuse loudly rather than recurse
    // until the process runs out of memory (issue #844, ADR-0023).
    const alreadyOnChain = chain.some(
      (entry) => entry.listKey === link.listKey && entry.fieldKey === link.fieldKey,
    )
    if (alreadyOnChain) {
      throw new ResolveOutputCycleError([...chain, link])
    }

    // Cost cap: a chain this long is refused only as a cost limit, never a
    // correctness one — an acyclic chain that works today can legitimately
    // reach this. Omit the field and warn instead of throwing.
    if (chain.length >= RESOLVE_CHAIN_MAX_LENGTH) {
      const path = [...chain, link].map((entry) => `${entry.listKey}.${entry.fieldKey}`).join(' → ')
      console.warn(
        `resolveOutput: omitting "${listKey}.${fieldName}" — its resolve chain exceeded ` +
          `RESOLVE_CHAIN_MAX_LENGTH (${RESOLVE_CHAIN_MAX_LENGTH}): ${path}. This is a cost limit, ` +
          `not an access denial.`,
      )
      return { readable: false }
    }

    // Use Promise.resolve() to handle both sync and async hooks
    const resolved = await Promise.resolve(
      hook({
        value,
        operation: 'query',
        fieldName,
        listKey,
        item: hookItem,
        context: deriveResolveOutputContext(args.context, link, config),
      }),
    )
    return { readable: true, value: resolved }
  }

  return { readable: true, value }
}

/**
 * Filter fields from an object based on read access
 * Recursively applies access control to nested relationships
 */
export async function filterReadableFields<T extends Record<string, unknown>>(
  item: T,
  fieldConfigs: Record<string, FieldConfig>,
  args: {
    session: Session | null
    context: AccessContext & { _isSudo?: boolean }
  },
  config?: OpenSaasConfig,
  depth: number = 0,
  listKey?: string,
  // Relation keys added purely to satisfy a field's `needs` (ADR-0025) at
  // THIS level, and the same tree for each nested relation reached via a
  // caller-named branch. Stripped from `filtered` right before it is
  // returned — after resolveOutput has had a chance to read them — so a
  // declared dependency never widens what the caller receives.
  declaredOnly: DeclaredOnlyTree = emptyDeclaredOnlyTree(),
  // The fragment scope this level was reached under (ADR-0027), and the same
  // tree one level down for each nested relation. `undefined` — the default,
  // and what a bare/`include`-based read passes at every level — means
  // unrestricted: every field on the list is computed, unchanged from
  // before ADR-0027. Only a `query` fragment's own field selection ever
  // restricts a level.
  selection?: FieldSelectionScope,
): Promise<Partial<T>> {
  const filtered: Record<string, unknown> = {}

  // Multi-column fields (e.g. storage image()/file() in Keystone-parity mode)
  // back several physical columns rather than one. Before the per-field pass,
  // assemble each such field's logical value from its raw columns and remove the
  // raw columns from the working row, so only the assembled value is exposed
  // (the raw per-part columns never leak). The assembled value then flows
  // through the normal read-access + resolveOutput path under the field's own
  // key. See ADR-0006.
  const workingItem: Record<string, unknown> = { ...item }
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (!fieldConfig.assembleColumns || !fieldConfig.getColumnNames) continue
    const columnNames = fieldConfig.getColumnNames(fieldName)
    // Only assemble when the raw columns are present in the row (i.e. they were
    // selected); otherwise leave the field absent from the result.
    const hasAnyColumn = columnNames.some((name) => name in workingItem)
    if (!hasAnyColumn) continue
    const assembled = fieldConfig.assembleColumns(fieldName, workingItem)
    for (const name of columnNames) {
      delete workingItem[name]
    }
    workingItem[fieldName] = assembled
  }

  // Keys denied by field-level read access during the pass below — as opposed
  // to a key merely skipped by `selection` or held back only for
  // `declaredOnly` stripping. Tracked separately because a denied key must
  // stay invisible to a computed field's hook (below), while a declared-only
  // key must stay VISIBLE to one — that is the entire point of declaring it
  // (ADR-0025) — even though `selection` above skipped adding it to
  // `filtered` because the caller's fragment never asked for it.
  const accessDeniedKeys = new Set<string>()

  // Process existing fields from the database result
  for (const [fieldName, value] of Object.entries(workingItem)) {
    const fieldConfig = fieldConfigs[fieldName]

    // Always include id, createdAt, updatedAt
    if (['id', 'createdAt', 'updatedAt'].includes(fieldName)) {
      filtered[fieldName] = value
      continue
    }

    // Projection-aware skip (ADR-0027): a fragment read that does not select
    // this field does no work for it at all — no field-level read-access
    // check, no resolveOutput, no recursion into a relation — because the
    // read is never going to return it. `selection` is only ever restricted
    // by a fragment's own field selection; a bare/`include`-based read, and a
    // relation reached only to satisfy another field's `needs`, pass no
    // selection at all and compute every field here, unchanged.
    if (selection?.fields && !selection.fields.has(fieldName)) {
      continue
    }

    // Handle relationship fields - recursively filter fields within related items
    // Note: Access control filtering is now done at database level via buildAccessScopedInclude
    // This only handles field-level access (hiding sensitive fields)
    //
    // Deliberately uncapped: the row/relation scoping in access-filter.ts bounds
    // what gets FETCHED (a caller include past its depth cap is now a denial,
    // not a passthrough — see ADR-0022), so by the time a result reaches this
    // function it is already a finite, acyclic tree whose depth was decided at
    // the pre-query phase. Capping recursion again here independently of that
    // cap used to let a relation be scoped correctly at the DB level while
    // still returning with unfiltered fields past this function's own,
    // separately-tracked limit (issue #830).
    if (
      config &&
      fieldConfig?.type === 'relationship' &&
      'ref' in fieldConfig &&
      fieldConfig.ref &&
      value !== null &&
      value !== undefined
    ) {
      // Gate the relationship on read access before recursing.
      const canRead = await checkFieldAccess(fieldConfig?.access, 'read', {
        ...args,
        item: workingItem,
      })

      if (!canRead) {
        accessDeniedKeys.add(fieldName)
        continue
      }

      const relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)
      // The declared-only tree for whatever THIS relation's own list computes,
      // e.g. a field on the related list that declares its own `needs`. Falls
      // back to an empty tree when this relation isn't declaration-related at
      // all — the common case.
      const nestedDeclaredOnly = declaredOnly.nested[fieldName] ?? emptyDeclaredOnlyTree()
      // This relation's own fragment scope, if the caller's fragment named it
      // with a nested Fragment/RelationSelector. `undefined` (a bare `true`
      // selector, or no `selection` at all) means the nested list computes
      // unrestricted — matching what naming a relation without narrowing it
      // further has always meant.
      const nestedSelection = selection?.nested[fieldName]

      if (relatedConfig) {
        // For many relationships (arrays) - recursively filter fields in each item
        // The recursive call already handles applying resolveOutput hooks
        if (Array.isArray(value)) {
          filtered[fieldName] = await Promise.all(
            value.map((relatedItem) =>
              filterReadableFields(
                relatedItem,
                relatedConfig.listConfig.fields,
                args,
                config,
                depth + 1,
                relatedConfig.listName,
                nestedDeclaredOnly,
                nestedSelection,
              ),
            ),
          )
        }
        // For single relationships (objects) - recursively filter fields
        // The recursive call already handles applying resolveOutput hooks
        else if (typeof value === 'object') {
          filtered[fieldName] = await filterReadableFields(
            value as Record<string, unknown>,
            relatedConfig.listConfig.fields,
            args,
            config,
            depth + 1,
            relatedConfig.listName,
            nestedDeclaredOnly,
            nestedSelection,
          )
        }
      } else {
        // Related config not found, include the value as-is
        filtered[fieldName] = value
      }
      continue
    }

    // Non-relationship field (or relationship without an includable value):
    // check read access and apply resolveOutput via the shared helper.
    const result = await resolveReadableFieldValue({
      fieldConfig,
      fieldName,
      value,
      accessItem: workingItem,
      hookItem: workingItem,
      listKey,
      args,
      config,
    })

    if (result.readable) {
      filtered[fieldName] = result.value
    } else {
      accessDeniedKeys.add(fieldName)
    }
  }

  // The item a virtual field's hook sees: stored columns and fetched
  // relations (from `workingItem`, never a resolved value — no hook's output
  // is ever written back into `workingItem`). A key is visible here if it
  // either survived into `filtered` (selected and allowed) OR exists only to
  // satisfy a `needs` declaration (`declaredOnly` — that IS the point of
  // declaring it: fetched for a hook, never for the caller, ADR-0025).
  // Everything else — field-level denied, or skipped by `selection` and
  // declared by no one — is deleted. A computed field reaches for exactly its
  // own declared dependencies and nothing another field's hook produced
  // (ADR-0027): reaching for a sibling that was denied or skipped-and-
  // undeclared finds nothing there, the same as reaching for one never
  // declared at all, and reaching for a sibling that DID survive finds its
  // raw stored form, never another hook's resolved value — a virtual field
  // computed earlier in declaration order is exactly as invisible as one
  // computed later.
  const computedFieldItem: Record<string, unknown> = { ...workingItem }
  for (const key of Object.keys(workingItem)) {
    if (['id', 'createdAt', 'updatedAt'].includes(key)) continue
    if (accessDeniedKeys.has(key)) {
      delete computedFieldItem[key]
      continue
    }
    if (key in filtered) continue
    if (declaredOnly.keys.has(key)) continue
    delete computedFieldItem[key]
  }

  // Process virtual fields - compute values from other fields
  // Virtual fields don't exist in the database result, so we need to compute them separately
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    // Skip if already processed (from database result)
    if (fieldName in filtered) {
      continue
    }

    // Only process virtual fields
    if (!fieldConfig.virtual) {
      continue
    }

    // Projection-aware skip (ADR-0027): same rule as the stored-field pass
    // above — a fragment that does not select this virtual field does no
    // work for it at all.
    if (selection?.fields && !selection.fields.has(fieldName)) {
      continue
    }

    // A virtual field with no resolveOutput hook can never produce a value
    // on ANY read — there is nothing to compute, so there is nothing to do,
    // including evaluating its read access (ADR-0027 reconciles the
    // access-only evaluation this branch used to preserve: a field that
    // never has output has no side effect worth preserving access for).
    if (!(fieldConfig.hooks?.resolveOutput && listKey)) {
      continue
    }

    // Check read access and compute the value via the shared helper.
    const result = await resolveReadableFieldValue({
      fieldConfig,
      fieldName,
      value: undefined, // Virtual fields don't have a database value
      accessItem: workingItem,
      hookItem: computedFieldItem,
      listKey,
      args,
      config,
    })

    if (result.readable) {
      filtered[fieldName] = result.value
    }
  }

  // Strip relations that were fetched ONLY to satisfy a `needs` declaration
  // (ADR-0025), now that every resolveOutput hook at this level has had the
  // chance to see them (via `computedFieldItem`, never `filtered` itself — a
  // declared dependency is read from stored columns, not from another
  // field's resolved output). A declared dependency is private plumbing, not
  // an implicit `include`: it never widens what the caller receives.
  for (const key of declaredOnly.keys) {
    delete filtered[key]
  }

  return filtered as Partial<T>
}
