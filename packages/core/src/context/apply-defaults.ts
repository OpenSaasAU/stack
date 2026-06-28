import type { FieldConfig } from '../config/types.js'

/**
 * Apply field `defaultValue`s to omitted inputs on CREATE — the runtime half of
 * the resolve-then-validate ordering (Keystone 6 parity, issue #615).
 *
 * A field's `defaultValue` is otherwise only realised as a Prisma `@default(...)`
 * applied by the database at write time, which is AFTER the write pipeline's
 * validation phase has already run. That ordering means a required-with-default
 * field (e.g. `select({ validation: { isRequired: true }, defaultValue: 'X' })`)
 * fails `isRequired` validation on an omitted input even though a default exists.
 *
 * This helper closes that gap: in the resolve phase (after `resolveInput` hooks,
 * before validation) it fills `resolvedData[field]` with the field's
 * `defaultValue` ONLY when the field was OMITTED (value is `undefined`). It is a
 * SINGLE shared mechanism used by both the top-level create path (Hook Pipeline)
 * and the nested-relation create path.
 *
 * Guard rails (each acceptance-criteria-driven):
 *   - CREATE only. Update never injects defaults for omitted fields (the caller
 *     only invokes this for `operation === 'create'`).
 *   - Explicitly-provided values are preserved. A key present in `resolvedData`
 *     — INCLUDING an explicit `null` — is left untouched; only `undefined`
 *     (omitted) keys are filled.
 *   - Virtual, system (`id`/`createdAt`/`updatedAt`) and relationship fields are
 *     skipped — they have no scalar `defaultValue` to inject and relationships
 *     carry connect/create payloads rather than literal defaults.
 *   - The timestamp `{ kind: 'now' }` sentinel is NOT injected: it is not a
 *     literal value but a request for the DB-level `@default(now())`, which still
 *     applies at write time. Injecting the sentinel object would corrupt the
 *     payload. (A concrete `Date` default is a real literal and IS injected.)
 *
 * The function mutates and returns `resolvedData` (consistent with the other
 * resolve-phase helpers that thread `resolvedData` through the pipeline).
 */
export function applyCreateDefaults(
  resolvedData: Record<string, unknown>,
  fieldConfigs: Record<string, FieldConfig>,
): Record<string, unknown> {
  for (const [fieldKey, fieldConfig] of Object.entries(fieldConfigs)) {
    // Skip virtual fields — not stored in the database.
    if (fieldConfig.virtual) continue

    // Skip system fields — always managed by the framework/DB.
    if (fieldKey === 'id' || fieldKey === 'createdAt' || fieldKey === 'updatedAt') continue

    // Skip relationships — they carry connect/create payloads, not literal defaults.
    if (fieldConfig.type === 'relationship') continue

    // No declared default → nothing to inject.
    if (!('defaultValue' in fieldConfig) || fieldConfig.defaultValue === undefined) continue

    // Only fill OMITTED keys. An explicitly-provided value (including explicit
    // `null`) is preserved and must not be overwritten by the default.
    if (resolvedData[fieldKey] !== undefined) continue

    const defaultValue = fieldConfig.defaultValue

    // The timestamp `{ kind: 'now' }` sentinel is a DB-level `@default(now())`
    // request, not a literal — leave it for Prisma to apply at write time.
    if (isNowSentinel(defaultValue)) continue

    resolvedData[fieldKey] = defaultValue
  }

  return resolvedData
}

/**
 * Detect the timestamp `{ kind: 'now' }` default sentinel.
 */
function isNowSentinel(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'now'
  )
}
