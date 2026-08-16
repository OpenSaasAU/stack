import type { AccessControl, Session, AccessContext, PrismaFilter } from './types.js'
import type { OpenSaasConfig, ListConfig } from '../config/types.js'

/**
 * Access engine — operation-level access control and shared helpers.
 *
 * This module holds the *operation-level* (list-level) access primitives and
 * the ref-parsing helper shared across both phases of the two-phase read:
 *
 *   - Phase 1, Access Filter (pre-query row/relation scoping): `access-filter.ts`
 *   - Phase 2, Field Visibility (post-query field stripping + resolveOutput +
 *     virtual fields): `field-visibility.ts`
 *
 * Field-level access evaluation is centralized in `field-access.ts`
 * (`checkFieldAccess`). See `docs/adr/0001-access-control-is-a-two-phase-read.md`
 * and the access-control glossary in `CONTEXT.md`.
 */

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function isPrismaFilter(value: unknown): value is PrismaFilter {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getRelatedListConfig(
  relationshipRef: string,
  config: OpenSaasConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { listName: string; listConfig: ListConfig<any> } | null {
  // Parse ref format: "ListName.fieldName" or "ListName"
  const parts = relationshipRef.split('.')
  if (parts.length !== 1 && parts.length !== 2) {
    return null
  }

  const listName = parts[0]
  const listConfig = config.lists[listName]

  if (!listConfig) {
    return null
  }

  return { listName, listConfig }
}

export async function checkAccess<T = Record<string, unknown>>(
  accessControl: AccessControl<T> | undefined,
  args: {
    session: Session | null
    item?: T
    context: AccessContext
  },
): Promise<boolean | PrismaFilter<T>> {
  // No access control means deny by default
  if (!accessControl) {
    return false
  }

  const result = await accessControl(args)

  return result
}

export function mergeFilters(
  userFilter: PrismaFilter | undefined,
  accessFilter: boolean | PrismaFilter,
): PrismaFilter | null {
  if (accessFilter === false) {
    return null
  }

  if (accessFilter === true) {
    return userFilter || {}
  }

  if (!userFilter) {
    return accessFilter
  }

  return {
    AND: [accessFilter, userFilter],
  }
}
