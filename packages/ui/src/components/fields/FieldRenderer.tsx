"use client";

import type { FieldConfig } from "@opensaas/core";
import { TextField } from "./TextField.js";
import { IntegerField } from "./IntegerField.js";
import { CheckboxField } from "./CheckboxField.js";
import { SelectField } from "./SelectField.js";
import { TimestampField } from "./TimestampField.js";
import { PasswordField } from "./PasswordField.js";
import { RelationshipField } from "./RelationshipField.js";
import { formatFieldName } from "../../lib/utils.js";

export interface FieldRendererProps {
  fieldName: string;
  fieldConfig: FieldConfig;
  value: any;
  onChange: (value: any) => void;
  error?: string;
  disabled?: boolean;
  mode?: "read" | "edit";
  relationshipItems?: Array<{ id: string; label: string }>;
  relationshipLoading?: boolean;
}

/**
 * Factory component that renders the appropriate field type
 * based on the field configuration
 */
export function FieldRenderer({
  fieldName,
  fieldConfig,
  value,
  onChange,
  error,
  disabled,
  mode = "edit",
  relationshipItems = [],
  relationshipLoading = false,
}: FieldRendererProps) {
  const label = (fieldConfig as any).label || formatFieldName(fieldName);
  const isRequired = (fieldConfig as any).validation?.isRequired || false;

  // Skip rendering ID and timestamp fields in forms
  if (mode === "edit" && ["id", "createdAt", "updatedAt"].includes(fieldName)) {
    return null;
  }

  switch (fieldConfig.type) {
    case "text":
      return (
        <TextField
          name={fieldName}
          value={value}
          onChange={onChange}
          label={label}
          error={error}
          disabled={disabled}
          required={isRequired}
          mode={mode}
        />
      );

    case "integer":
      return (
        <IntegerField
          name={fieldName}
          value={value}
          onChange={onChange}
          label={label}
          error={error}
          disabled={disabled}
          required={isRequired}
          mode={mode}
        />
      );

    case "checkbox":
      return (
        <CheckboxField
          name={fieldName}
          value={value}
          onChange={onChange}
          label={label}
          error={error}
          disabled={disabled}
          mode={mode}
        />
      );

    case "select":
      if (!fieldConfig.options) {
        console.warn(`Select field "${fieldName}" is missing options`);
        return null;
      }
      return (
        <SelectField
          name={fieldName}
          value={value}
          onChange={onChange}
          label={label}
          options={fieldConfig.options.map((opt: string | { label: string; value: string }) =>
            typeof opt === "string" ? { label: opt, value: opt } : opt,
          )}
          error={error}
          disabled={disabled}
          required={isRequired}
          mode={mode}
        />
      );

    case "timestamp":
      return (
        <TimestampField
          name={fieldName}
          value={value}
          onChange={onChange}
          label={label}
          error={error}
          disabled={disabled}
          required={isRequired}
          mode={mode}
        />
      );

    case "password":
      return (
        <PasswordField
          name={fieldName}
          value={value}
          onChange={onChange}
          label={label}
          error={error}
          disabled={disabled}
          required={isRequired}
          mode={mode}
          showConfirm={mode === "edit"}
        />
      );

    case "relationship":
      return (
        <RelationshipField
          name={fieldName}
          value={value}
          onChange={onChange}
          label={label}
          items={relationshipItems}
          error={error}
          disabled={disabled}
          required={isRequired}
          mode={mode}
          isLoading={relationshipLoading}
        />
      );

    default:
      console.warn(`Unknown field type: ${(fieldConfig as any).type}`);
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">
            {label}
          </label>
          <p className="text-sm text-muted-foreground">
            Unsupported field type: {(fieldConfig as any).type}
          </p>
        </div>
      );
  }
}
