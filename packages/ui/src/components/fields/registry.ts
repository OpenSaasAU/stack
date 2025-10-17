import type { ComponentType } from "react";
import { TextField } from "./TextField.js";
import { IntegerField } from "./IntegerField.js";
import { CheckboxField } from "./CheckboxField.js";
import { SelectField } from "./SelectField.js";
import { TimestampField } from "./TimestampField.js";
import { PasswordField } from "./PasswordField.js";
import { RelationshipField } from "./RelationshipField.js";
import type { FieldRendererProps } from "./FieldRenderer.js";

/**
 * Base props that all field components must accept
 */
export type FieldComponentProps = Omit<
  FieldRendererProps,
  "fieldConfig" | "relationshipItems" | "relationshipLoading"
> & {
  label: string;
  required: boolean;
};

/**
 * Type for field component
 */
export type FieldComponent = ComponentType<any>;

/**
 * Registry mapping field types to their default UI components
 * This can be extended for custom field types
 */
export const fieldComponentRegistry: Record<string, FieldComponent> = {
  text: TextField,
  integer: IntegerField,
  checkbox: CheckboxField,
  select: SelectField,
  timestamp: TimestampField,
  password: PasswordField,
  relationship: RelationshipField,
};

/**
 * Register a custom field component for a field type
 * Useful for adding support for custom field types
 */
export function registerFieldComponent(
  fieldType: string,
  component: FieldComponent,
): void {
  fieldComponentRegistry[fieldType] = component;
}

/**
 * Get the component for a field type
 * Returns undefined if no component is registered
 */
export function getFieldComponent(fieldType: string): FieldComponent | undefined {
  return fieldComponentRegistry[fieldType];
}
