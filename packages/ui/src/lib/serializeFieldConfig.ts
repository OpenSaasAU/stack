import type { FieldConfig, OpenSaasConfig } from '@opensaas/stack-core'
import type { SelectOption } from '@opensaas/stack-core/fields'
import { isRelationshipField, shouldHaveForeignKey } from '@opensaas/stack-core/fields'
import { resolveJunctionEdge } from '@opensaas/stack-core'
import { resolveToManyEdgePlan } from './relationshipEdges.js'
import type { ComponentType } from 'react'
import type { CellComponent } from '../components/cells/registry.js'
import { rendersAsRelationshipTable } from './deriveItemView.js'

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
  /**
   * Set on a to-many relationship whose edges the form MAY write, naming the
   * related list each write runs against and the back-reference column that
   * holds the link (ADR-0050). The submit transform sends nothing for the
   * field — the edges are written one row at a time against that list, under
   * its own access — so a field carrying this is neither in the payload nor
   * read-only.
   */
  edgeWrite?: { relatedListKey: string; backReferenceField: string }
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
 * picker it would otherwise render.
 */
export const UNWRITABLE_RELATIONSHIP_REASON =
  'Not editable here — the related record holds this link. Edit it from the other list.'

/**
 * Shown in place of {@link UNWRITABLE_RELATIONSHIP_REASON} for a to-many that
 * is an edge across an explicit junction list (#1329).
 *
 * The field is still unwritable *here*: an edge is a row of the junction list
 * with its own access rules, so it can never ride in this record's write
 * payload (ADR-0050). What changed is that the capability now exists — the
 * record's own item view renders this field as a table that adds and removes
 * edges under that list's access — so the message points at the control that
 * has it rather than at another list's edit page.
 *
 * The table is never on the form showing this message: a field rendered as a
 * table is a section of the item view rather than a field of the details form,
 * so the only forms that serialize it are the create page and the standalone
 * forms. Hence "this relationship's table" rather than "here" — and no claim
 * about *where* that table is, since a standalone form can be embedded in an
 * app that has no admin item view. A field demoted to the compact picker has no
 * table anywhere and keeps {@link UNWRITABLE_RELATIONSHIP_REASON} — see
 * {@link markUnwritableRelationships}.
 */
export const JUNCTION_EDGE_RELATIONSHIP_REASON =
  'Not editable here — add or remove these links from this relationship’s table.'

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
  // case but needs the whole config to recognise — see
  // {@link markUnwritableRelationships}.
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

/**
 * Mark every relationship whose foreign key lives on the related row, so no
 * editable control renders for it.
 *
 * {@link serializeFieldConfig} already catches the to-many case from the field
 * alone. The other case — the non-owning end of a one-to-one, where both ends
 * are `many: false` and only one holds the column — is not visible in the
 * field config and needs the whole config to answer (ADR-0064).
 *
 * It also restates the reason for a to-many that is an edge across an explicit
 * junction list AND is rendered as a table on the item view, whose links that
 * table can now add and remove (#1329). The mark itself is unchanged: the field
 * is unwritable through this form either way.
 *
 * Mutates `serializableFields` in place.
 */
export function markUnwritableRelationships(
  serializableFields: Record<string, SerializableFieldConfig>,
  listKey: string,
  fields: Record<string, FieldConfig>,
  config: OpenSaasConfig,
): void {
  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (!isRelationshipField(fieldConfig)) continue
    const serialized = serializableFields[fieldName]
    if (!serialized) continue
    // The mark stands — a to-many can never ride in this record's payload — but
    // an edge across a junction now has a control of its own, so the reason
    // names it rather than sending the user to another list. Only the reason
    // this branch owns is replaced: a field read-only for some other cause
    // (`ui.readOnly`) keeps the reason that cause gave it. And only a field the
    // item view renders as a table has that control at all — a picker-demoted
    // one has no table anywhere, so the message would name something that does
    // not exist.
    if (serialized.readOnly) {
      if (
        serialized.readOnlyReason === UNWRITABLE_RELATIONSHIP_REASON &&
        rendersAsRelationshipTable(fieldConfig) &&
        resolveJunctionEdge(config, listKey, fieldName)
      ) {
        serialized.readOnlyReason = JUNCTION_EDGE_RELATIONSHIP_REASON
      }
      continue
    }
    // `shouldHaveForeignKey` throws on a ref naming a list the config does not
    // declare. `validateRelations` refuses that at `generate`, so reaching it
    // here means an unvalidated config — leave the field alone rather than
    // failing the whole page render.
    if (!config.lists[fieldConfig.ref.split('.')[0]]) continue
    if (shouldHaveForeignKey(listKey, fieldName, fieldConfig, config)) continue
    serialized.readOnly = true
    serialized.readOnlyReason = UNWRITABLE_RELATIONSHIP_REASON
  }
}

/**
 * Make every to-many relationship whose edges CAN be written from this form
 * writable, replacing the read-only mark {@link serializeFieldConfig} gave it
 * with the plan those writes follow (ADR-0050).
 *
 * Only a form editing an existing record may do this: an edge is a write
 * against the related row naming the parent, and a create has no parent id to
 * name yet. Callers therefore pass the record's own id, and pass nothing on
 * create.
 *
 * Runs after {@link markUnwritableRelationships}, and replaces only the marks
 * that pass owns: a field read-only for some other cause keeps that cause.
 *
 * Mutates `serializableFields` in place.
 */
export function markToManyEdgeWrites(
  serializableFields: Record<string, SerializableFieldConfig>,
  listKey: string,
  fields: Record<string, FieldConfig>,
  config: OpenSaasConfig,
  itemId: unknown,
): void {
  if (itemId === undefined || itemId === null || itemId === '') return

  for (const fieldName of Object.keys(fields)) {
    const serialized = serializableFields[fieldName]
    if (!serialized || serialized.many !== true) continue
    if (
      serialized.readOnlyReason !== UNWRITABLE_RELATIONSHIP_REASON &&
      serialized.readOnlyReason !== JUNCTION_EDGE_RELATIONSHIP_REASON
    ) {
      continue
    }
    const plan = resolveToManyEdgePlan(config, listKey, fieldName)
    if (!plan) continue
    serialized.edgeWrite = plan
    delete serialized.readOnly
    delete serialized.readOnlyReason
  }
}
