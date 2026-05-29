import type { Session, AccessContext } from './types.js'
import type { FieldAccess } from './types.js'

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
  fieldConfigs: Record<string, { access?: FieldAccess; type?: string }>,
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
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldConfig.type === 'relationship') {
      // For non-many relationships, Prisma creates a foreign key field named `${fieldName}Id`
      const relConfig = fieldConfig as { many?: boolean }
      if (!relConfig.many) {
        foreignKeyFields.add(`${fieldName}Id`)
      }
    }
  }

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

    // Check field access (checkFieldAccess already handles sudo mode)
    const canWrite = await checkFieldAccess(fieldConfig?.access, operation, {
      ...args,
      inputData: args.inputData,
    })

    if (canWrite) {
      filtered[fieldName] = value
    }
  }

  return filtered as Partial<T>
}
