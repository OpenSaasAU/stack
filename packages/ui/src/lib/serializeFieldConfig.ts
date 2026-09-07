import type { FieldConfig } from '@opensaas/stack-core'
import type { SelectOption } from '@opensaas/stack-core/fields'
import type { ComponentType } from 'react'
import type { CellComponent } from '../components/cells/registry.js'

/** The client-safe projection of a `FieldConfig` — see {@link serializeFieldConfig}. */
export type SerializableFieldConfig = {
  type: string
  label?: string
  validation?: {
    isRequired?: boolean
    length?: { min?: number; max?: number }
    min?: number
    max?: number
  }
  /**
   * Select options. Carries the additive per-option `ui.variant` metadata
   * (issue #729) so list-table select Cells can colour their badge.
   */
  options?: Array<SelectOption>
  many?: boolean
  ref?: string
  /**
   * Whether the field is a virtual (computed, non-DB) field. Serialised so the
   * client can omit sort affordances for virtual columns (issue #732) — virtual
   * fields have no column to order by.
   */
  virtual?: boolean
  /**
   * Set when an item form must not offer this field as an editable control,
   * because a value it collected could not be written. `FieldRenderer` forces
   * read-only presentation for it and surfaces {@link readOnlyReason}, and the
   * submit transform sends nothing for it.
   */
  readOnly?: boolean
  /** Why {@link readOnly} is set — shown to the user beneath the field. */
  readOnlyReason?: string
  ui?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component?: ComponentType<any>
    /**
     * Per-field Cell override — the highest-priority entry in the cell
     * resolution chain, mirroring `component` for form fields (issue #729).
     */
    cell?: CellComponent
    fieldType?: string
    /** Help / description text surfaced to the field component as `helpText`. */
    description?: string
    /** Whether this field belongs in a list's DEFAULT column set (issue #1018) — see `BaseFieldConfig.ui.listView`. */
    listView?: {
      defaultColumn?: boolean
    }
    [key: string]: unknown
  }
}

/**
 * Shown beneath a relationship an item form cannot write, in place of the
 * picker it would otherwise render. Exported so `prepareItemForm` marks the
 * non-owning end of a one-to-one — which needs the whole config to recognise —
 * with the same wording this module applies to a to-many.
 */
export const UNWRITABLE_RELATIONSHIP_REASON =
  'Not editable here — the related record holds this link. Edit it from the other list.'

/**
 * Omits functions (getZodSchema, getContractField, getFilterSpec) and
 * non-serializable properties (access, hooks, typePatch, valueForClientSerialization).
 */
export function serializeFieldConfig(fieldConfig: FieldConfig): SerializableFieldConfig {
  const config: SerializableFieldConfig = {
    type: fieldConfig.type,
  }

  if (fieldConfig.ui) {
    const { valueForClientSerialization: _valueForClientSerialization, ...serializableUi } =
      fieldConfig.ui
    config.ui = serializableUi
  }

  if ('label' in fieldConfig && fieldConfig.label !== undefined) {
    config.label = fieldConfig.label as string
  }

  if ('validation' in fieldConfig && fieldConfig.validation !== undefined) {
    config.validation = fieldConfig.validation as SerializableFieldConfig['validation']
  }

  if ('options' in fieldConfig && fieldConfig.options !== undefined) {
    config.options = fieldConfig.options as Array<SelectOption>
  }

  if ('many' in fieldConfig && fieldConfig.many !== undefined) {
    config.many = fieldConfig.many as boolean
  }

  if ('ref' in fieldConfig && fieldConfig.ref !== undefined) {
    config.ref = fieldConfig.ref as string
  }

  if ('virtual' in fieldConfig && fieldConfig.virtual === true) {
    config.virtual = true
  }

  // A to-many relationship's foreign key lives on the related row, so a value
  // collected here has no column to land in and the engine refuses it
  // (ADR-0050). Marking it read-only is what stops the form offering an edit it
  // would then have to discard. The non-owning end of a one-to-one is the same
  // case but needs the whole config to recognise — `prepareItemForm` adds it.
  if (config.type === 'relationship' && config.many === true) {
    config.readOnly = true
    config.readOnlyReason = UNWRITABLE_RELATIONSHIP_REASON
  }

  return config
}

/** Same as {@link serializeFieldConfig}, applied to every field in a list's fields map. */
export function serializeFieldConfigs(
  fields: Record<string, FieldConfig>,
): Record<string, SerializableFieldConfig> {
  const serialized: Record<string, SerializableFieldConfig> = {}

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    serialized[fieldName] = serializeFieldConfig(fieldConfig)
  }

  return serialized
}
