import type { Session, AccessContext } from './types.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'
import { getRelatedListConfig } from './engine.js'
import { checkFieldAccess } from './field-access.js'
import { RESOLVE_CHAIN_MAX_LENGTH } from './depth-limits.js'
import { ResolveOutputCycleError } from './errors.js'
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
 * object passed to the hook as `item` (these differ for virtual fields, which
 * see the already-filtered output so they can read sibling fields).
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

  // Process existing fields from the database result
  for (const [fieldName, value] of Object.entries(workingItem)) {
    const fieldConfig = fieldConfigs[fieldName]

    // Always include id, createdAt, updatedAt
    if (['id', 'createdAt', 'updatedAt'].includes(fieldName)) {
      filtered[fieldName] = value
      continue
    }

    // Handle relationship fields - recursively filter fields within related items
    // Note: Access control filtering is now done at database level via buildIncludeWithAccessControl
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
        continue
      }

      const relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)

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
    }
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

    // Virtual fields must have a resolveOutput hook to compute their value;
    // without one there is nothing to add to the result.
    if (!(fieldConfig.hooks?.resolveOutput && listKey)) {
      // Still evaluate read access to preserve any access-fn side effects.
      await checkFieldAccess(fieldConfig.access, 'read', { ...args, item: workingItem })
      continue
    }

    // Check read access and compute the value via the shared helper. Virtual
    // fields see the already-filtered item so they can read sibling fields.
    const result = await resolveReadableFieldValue({
      fieldConfig,
      fieldName,
      value: undefined, // Virtual fields don't have a database value
      accessItem: workingItem,
      hookItem: filtered,
      listKey,
      args,
      config,
    })

    if (result.readable) {
      filtered[fieldName] = result.value
    }
  }

  return filtered as Partial<T>
}
