import type { ComponentType } from 'react'
import type { SerializableFieldConfig } from '../../lib/serializeFieldConfig.js'
import { TextCell } from './TextCell.js'
import { IntegerCell } from './IntegerCell.js'
import { CheckboxCell } from './CheckboxCell.js'
import { SelectCell } from './SelectCell.js'
import { TimestampCell } from './TimestampCell.js'
import { RelationshipCell } from './RelationshipCell.js'

/**
 * Props every Cell component receives. A Cell is the list-table rendering of
 * one field's value (see `CONTEXT.md` — "Cell"). Props are deliberately
 * serialisable — `value` is the JSON-safe, access-filtered field value and
 * `field` is the serialised field config — so Cells stay drop-in for the
 * server-driven list view.
 */
export type CellComponentProps = {
  /** The access-filtered, JSON-serialisable field value for this row. */
  value: unknown
  /** Serialised config for this column's field — drives options, ref, etc. */
  field: SerializableFieldConfig
  /** Raw field/column key. */
  fieldName: string
  /** Admin base path, used by relationship Cells to build links. */
  basePath?: string
}

/**
 * A Cell component. Unlike form-field components (which have per-type prop
 * shapes and so widen to `ComponentType<any>` in their registry), every Cell
 * shares one prop contract, so this stays strongly typed.
 */
export type CellComponent = ComponentType<CellComponentProps>

/**
 * Registry mapping field types to their default Cell components — the
 * field-type layer of the resolution chain. Mirrors `fieldComponentRegistry`
 * for form fields; extend it with {@link registerCellComponent} exactly the
 * same way a third-party field registers its form component.
 */
const cellComponentRegistry: Record<string, CellComponent> = {
  text: TextCell,
  integer: IntegerCell,
  checkbox: CheckboxCell,
  select: SelectCell,
  timestamp: TimestampCell,
  relationship: RelationshipCell,
}

/**
 * Register a default Cell component for a field type. A third-party field
 * package calls this to make its values render correctly in tables, exactly as
 * it calls `registerFieldComponent` for its form component.
 *
 * @param fieldType - The field type identifier
 * @param component - A Cell component accepting {@link CellComponentProps}
 */
export function registerCellComponent(fieldType: string, component: CellComponent): void {
  cellComponentRegistry[fieldType] = component
}

/**
 * Get the Cell component registered for a field type, or `undefined` when none
 * is registered (the caller falls back to plain text).
 */
export function getCellComponent(fieldType: string): CellComponent | undefined {
  return cellComponentRegistry[fieldType]
}

export { cellComponentRegistry }
