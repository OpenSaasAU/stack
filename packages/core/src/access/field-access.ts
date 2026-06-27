import type { Session, AccessContext } from './types.js'
import type { FieldAccess } from './types.js'
// `ValidationError` is referenced only inside function bodies (call-time), never
// at module-evaluation time, so the field-access ⇄ hooks import cycle is safe
// under ESM live bindings.
import { ValidationError } from '../hooks/index.js'

/**
 * Shared field-level access evaluation.
 *
 * This module is the single, canonical home for field-level access checks. Both
 * read-time (Field Visibility, see `field-visibility.ts`) and write-time paths
 * evaluate field access through `checkFieldAccess` — there is intentionally no
 * second, parallel field-access evaluator. See
 * `docs/adr/0001-access-control-is-a-two-phase-read.md` and the access-control
 * glossary in `CONTEXT.md` for the two-phase read model that motivates this.
 */

/**
 * Check field-level access for a specific operation.
 *
 * This is the canonical field-access evaluator. Its signature is deliberate:
 * field access can depend on the `operation`, on the already-fetched `item`
 * (read/update/delete), and on the `inputData` being written (create/update),
 * so all of those are accepted. Do not introduce a parallel evaluator with a
 * narrower signature.
 */
export async function checkFieldAccess(
  fieldAccess: FieldAccess | undefined,
  operation: 'read' | 'create' | 'update',
  args: {
    session: Session | null
    item?: Record<string, unknown>
    context: AccessContext & { _isSudo?: boolean }
    inputData?: Record<string, unknown>
  },
): Promise<boolean> {
  // Skip access check in sudo mode
  if (args.context._isSudo) {
    return true
  }

  if (!fieldAccess) {
    return true // No field access means allow
  }

  const accessControl = fieldAccess[operation]
  if (!accessControl) {
    return true // No specific access control means allow
  }

  const result = await accessControl({
    session: args.session,
    item: args.item,
    context: args.context,
    inputData: args.inputData,
    operation,
  } as Parameters<typeof accessControl>[0])

  // If result is false, deny access
  if (result === false) {
    return false
  }

  // If result is true, allow access
  if (result === true) {
    return true
  }

  // Default to allowing access if we can't determine
  return true
}

/**
 * Simple filter matching for field-level access
 * Checks if an item matches a Prisma-like filter object
 */
function matchesFilter(item: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (typeof condition === 'object' && condition !== null) {
      // Handle nested conditions like { equals: value }
      if ('equals' in condition) {
        if (item[key] !== condition.equals) {
          return false
        }
      } else if ('not' in condition) {
        if (item[key] === condition.not) {
          return false
        }
      }
      // Add more condition types as needed
    } else {
      // Direct equality check
      if (item[key] !== condition) {
        return false
      }
    }
  }
  return true
}

/**
 * Filter fields from input data based on write access (create/update)
 */
export async function filterWritableFields<T extends Record<string, unknown>>(
  data: T,
  fieldConfigs: Record<
    string,
    {
      access?: FieldAccess
      type?: string
      getColumnNames?: (fieldName: string) => string[]
    }
  >,
  operation: 'create' | 'update',
  args: {
    session: Session | null
    item?: Record<string, unknown>
    context: AccessContext & { _isSudo?: boolean }
    inputData?: Record<string, unknown>
  },
): Promise<Partial<T>> {
  const filtered: Record<string, unknown> = {}

  // Build a set of foreign key field names to exclude
  // Foreign keys should not be in the data when using Prisma's relation syntax
  const foreignKeyFields = new Set<string>()
  // Map each raw per-part column name contributed by a multi-column field
  // (e.g. storage image()/file() in Keystone-parity mode) back to its OWNING
  // declared field. These columns are injected into the write payload by the
  // field's `splitColumns` AFTER resolveInput and are intentionally NOT declared
  // as their own entries in `fieldConfigs`, so without this map they would trip
  // the #564 undeclared-key reject below.
  //
  // SECURITY (#568): a raw column must NOT be blanket-passed through. The hooks
  // layer (`executeFieldResolveInputHooks`) only gates the owning field when the
  // LOGICAL key (e.g. `media`) is present, because it iterates declared fields,
  // not data keys. A non-sudo caller who supplies the raw columns DIRECTLY
  // (`data: { media_url, media_size }`) never produces that logical key, so that
  // gate never fires. We therefore gate each raw column HERE by its owning
  // field's write access — denied (non-sudo) throws, allowed (or sudo) passes
  // through — so the legitimate multi-column write path is preserved while the
  // direct-raw-column bypass is closed.
  const splitColumnOwners = new Map<string, { fieldName: string; access?: FieldAccess }>()
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldConfig.type === 'relationship') {
      // For non-many relationships, Prisma creates a foreign key field named `${fieldName}Id`
      const relConfig = fieldConfig as { many?: boolean }
      if (!relConfig.many) {
        foreignKeyFields.add(`${fieldName}Id`)
      }
    }
    if (typeof fieldConfig.getColumnNames === 'function') {
      for (const column of fieldConfig.getColumnNames(fieldName)) {
        splitColumnOwners.set(column, { fieldName, access: fieldConfig.access })
      }
    }
  }

  const isSudo = args.context._isSudo === true

  for (const [fieldName, value] of Object.entries(data)) {
    const fieldConfig = fieldConfigs[fieldName]

    // Skip system fields
    if (['id', 'createdAt', 'updatedAt'].includes(fieldName)) {
      continue
    }

    // Skip virtual fields - they don't store in database
    // Virtual fields with resolveInput hooks handle side effects separately
    if (fieldConfig && 'virtual' in fieldConfig && fieldConfig.virtual) {
      continue
    }

    // Skip foreign key fields (e.g., authorId) when their corresponding relationship field exists
    // This prevents conflicts when using Prisma's relation syntax (e.g., author: { connect: { id } })
    if (foreignKeyFields.has(fieldName)) {
      continue
    }

    // Raw per-part columns produced by a multi-column field's `splitColumns`.
    // They are undeclared by design, so they must not trip the #564 reject — but
    // they must NOT be blanket-passed through either: gate each one by its
    // OWNING field's write access (see the SECURITY note where the map is built).
    // This is the real gate for callers who supply the raw columns directly,
    // because the logical-key gate in `executeFieldResolveInputHooks` never fires
    // for them. Denied (non-sudo) throws — same fail-loud behaviour as a denied
    // declared field (#568); allowed (or sudo, via `checkFieldAccess`) passes
    // through, preserving the legitimate multi-column write path.
    const splitColumnOwner = splitColumnOwners.get(fieldName)
    if (splitColumnOwner) {
      const canWrite = await checkFieldAccess(splitColumnOwner.access, operation, {
        ...args,
        inputData: args.inputData,
      })
      if (!canWrite) {
        throw new ValidationError([
          `Cannot ${operation} "${splitColumnOwner.fieldName}" (via column "${fieldName}"): ` +
            `field-level access denied.`,
        ])
      }
      filtered[fieldName] = value
      continue
    }

    // #564 — undeclared data keys must fail CLOSED.
    // A key with no entry in `fieldConfigs` is not a field the list config
    // exposes. The generated Prisma model has MORE fields than the config
    // declares (e.g. back-relations like `from_Enrolment_student`), so allowing
    // an undeclared key to pass through lets a non-sudo caller drive ungated
    // nested writes on undeclared back-relations. Mirror Keystone's
    // GraphQL-schema behaviour and reject it. `sudo` is the single trusted
    // bypass, so undeclared keys still pass through under sudo.
    if (!fieldConfig) {
      if (isSudo) {
        filtered[fieldName] = value
        continue
      }
      throw new ValidationError([
        `Cannot ${operation} "${fieldName}": it is not a field of this list. ` +
          `Undeclared data keys are rejected (use sudo to bypass).`,
      ])
    }

    // #568 — fields denied by field-level access must THROW, not be silently
    // dropped. Keystone threw a GraphQL access error for the same situation;
    // silently stripping the field lets a write "succeed" while doing less than
    // asked (and skips any hook side effects gated on that field).
    // `checkFieldAccess` already returns `true` under sudo, so sudo writes never
    // reach the throw below — no parallel sudo path is needed here.
    const canWrite = await checkFieldAccess(fieldConfig.access, operation, {
      ...args,
      inputData: args.inputData,
    })

    if (!canWrite) {
      throw new ValidationError([`Cannot ${operation} "${fieldName}": field-level access denied.`])
    }

    filtered[fieldName] = value
  }

  return filtered as Partial<T>
}
