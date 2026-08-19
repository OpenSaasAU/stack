import type { ComponentType } from 'react'
import { TextField } from './TextField.js'
import { IntegerField } from './IntegerField.js'
import { BigIntField } from './BigIntField.js'
import { CheckboxField } from './CheckboxField.js'
import { SelectField } from './SelectField.js'
import { TimestampField } from './TimestampField.js'
import { PasswordField } from './PasswordField.js'
import { RelationshipField } from './RelationshipField.js'
import { JsonField } from './JsonField.js'
import { FileField } from './FileField.js'
import { ImageField } from './ImageField.js'
import { VirtualField } from './VirtualField.js'

export type FieldComponentProps = {
  name: string
  value: unknown
  onChange: (value: unknown) => void
  label: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
}

/**
 * Field components have per-type prop shapes (e.g. `value: string` vs
 * `value: number`), so this widens to accept anything satisfying the base
 * `FieldComponentProps` shape plus arbitrary extra props — unlike
 * `CellComponent`, which shares one prop contract and stays strongly typed.
 */
export type FieldComponent = ComponentType<FieldComponentProps & Record<string, unknown>>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fieldComponentRegistry: Record<string, ComponentType<any>> = {
  text: TextField,
  integer: IntegerField,
  bigInt: BigIntField,
  checkbox: CheckboxField,
  select: SelectField,
  timestamp: TimestampField,
  password: PasswordField,
  relationship: RelationshipField,
  json: JsonField,
  file: FileField,
  image: ImageField,
  virtual: VirtualField,
}

/** Register a custom field component for a field type. */
export function registerFieldComponent(
  fieldType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>,
): void {
  fieldComponentRegistry[fieldType] = component
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getFieldComponent(fieldType: string): ComponentType<any> | undefined {
  return fieldComponentRegistry[fieldType]
}
