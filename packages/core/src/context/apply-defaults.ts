import type { FieldConfig } from '../config/types.js'

/**
 * Fills a field's `defaultValue` into `resolvedData` for CREATE when the field
 * was omitted, run after resolveInput hooks and before validation. Shared by
 * the top-level create path (Hook Pipeline) and the nested-relation create path.
 *
 * Prisma only realises `defaultValue` as `@default(...)` at the database write,
 * which is after this pipeline's validation phase — so without this, a
 * required field with a default (e.g. `select({ validation: { isRequired: true },
 * defaultValue: 'X' })`) fails `isRequired` on an omitted input. See issue #615.
 */
export function applyCreateDefaults(
  resolvedData: Record<string, unknown>,
  fieldConfigs: Record<string, FieldConfig>,
  /**
   * Populated (if supplied) with every field key this call actually filled —
   * i.e. the caller and every `resolveInput` hook left it `undefined`, and
   * this function alone supplied the value. The write pipeline uses this to
   * exempt exactly these keys from field-level `create` access
   * (`filterWritableFields`, `packages/core/src/access/field-access.ts`): a
   * field carrying a fixed `create: () => false` deny (a write-denied Auth
   * list field, ADR-0073, is the motivating case) still needs its OWN
   * declared default to persist when the caller omits it — the same value
   * Postgres's own `@default(...)` would have produced had this function not
   * needed to materialise it early to satisfy `isRequired` validation
   * (issue #615). A key the caller or a hook actually supplied is never
   * added here, so it is never exempted — the deny still applies to it.
   */
  defaultedFields?: Set<string>,
): Record<string, unknown> {
  for (const [fieldKey, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldConfig.virtual) continue
    if (fieldKey === 'id' || fieldKey === 'createdAt' || fieldKey === 'updatedAt') continue
    // Relationships carry connect/create payloads, not literal defaults.
    if (fieldConfig.type === 'relationship') continue
    if (!('defaultValue' in fieldConfig) || fieldConfig.defaultValue === undefined) continue

    // Only fill OMITTED (`undefined`) keys — an explicitly-provided value,
    // including explicit `null`, must survive untouched.
    if (resolvedData[fieldKey] !== undefined) continue

    const defaultValue = fieldConfig.defaultValue

    // `{ kind: 'now' }` requests the DB-level `@default(now())`, not a literal
    // value — injecting the sentinel object itself would corrupt the payload.
    if (isNowSentinel(defaultValue)) continue

    resolvedData[fieldKey] = defaultValue
    defaultedFields?.add(fieldKey)
  }

  return resolvedData
}

export function isNowSentinel(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'now'
  )
}
