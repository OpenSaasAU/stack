import type { ComponentType } from 'react'
import { TextField } from './TextField.js'
import { IntegerField } from './IntegerField.js'
import { CheckboxField } from './CheckboxField.js'
import { SelectField } from './SelectField.js'
import { TimestampField } from './TimestampField.js'
import { PasswordField } from './PasswordField.js'
import { RelationshipField } from './RelationshipField.js'
import { JsonField } from './JsonField.js'
import { FileField } from './FileField.js'
import { ImageField } from './ImageField.js'

/**
 * Base props that all field components must accept
 * Field components can extend this with additional field-specific props
 */
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
 * Type for field component
 * Field components must accept props that extend FieldComponentProps.
 * The registry uses ComponentType<any> because components have different
 * specific prop types (e.g., value: string vs value: number), but all
 * must include the base FieldComponentProps structure.
 */
export type FieldComponent = ComponentType<FieldComponentProps & Record<string, unknown>>

/**
 * Registry mapping field types to their default UI components
 * This can be extended for custom field types
 * Uses ComponentType<any> to allow components with more specific prop types
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fieldComponentRegistry: Record<string, ComponentType<any>> = {
  text: TextField,
  integer: IntegerField,
  checkbox: CheckboxField,
  select: SelectField,
  timestamp: TimestampField,
  password: PasswordField,
  relationship: RelationshipField,
  json: JsonField,
  file: FileField,
  image: ImageField,
}

/**
 * Register a custom field component for a field type
 * Useful for adding support for custom field types
 *
 * @param fieldType - The field type identifier
 * @param component - A React component that accepts FieldComponentProps (and optionally additional props)
 */
export function registerFieldComponent(
  fieldType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>,
): void {
  fieldComponentRegistry[fieldType] = component
}

/**
 * Get the component for a field type
 * Returns undefined if no component is registered
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getFieldComponent(fieldType: string): ComponentType<any> | undefined {
  return fieldComponentRegistry[fieldType]
}
