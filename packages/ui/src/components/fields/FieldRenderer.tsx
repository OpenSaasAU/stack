"use client";

import type { FieldConfig } from "@opensaas/core";
import { getFieldComponent } from "./registry.js";
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
 * based on the field configuration and component registry
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

  // Get component from:
  // 1. Per-field component override (ui.component)
  // 2. Custom field type override (ui.fieldType) - uses global registry
  // 3. Default field type (fieldConfig.type) - uses global registry
  const Component =
    fieldConfig.ui?.component ||
    (fieldConfig.ui?.fieldType
      ? getFieldComponent(fieldConfig.ui.fieldType)
      : getFieldComponent(fieldConfig.type));

  if (!Component) {
    console.warn(`No component registered for field type: ${fieldConfig.type}`);
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-muted-foreground">
          {label}
        </label>
        <p className="text-sm text-muted-foreground">
          Unsupported field type: {fieldConfig.type}
        </p>
      </div>
    );
  }

  // Build props based on field type
  const baseProps = {
    name: fieldName,
    value,
    onChange,
    label,
    error,
    disabled,
    required: isRequired,
    mode,
  };

  // Add field-type-specific props
  const specificProps: Record<string, any> = {};

  if (fieldConfig.type === "select" && fieldConfig.options) {
    specificProps.options = fieldConfig.options.map(
      (opt: string | { label: string; value: string }) =>
        typeof opt === "string" ? { label: opt, value: opt } : opt,
    );
  }

  if (fieldConfig.type === "password") {
    specificProps.showConfirm = mode === "edit";
  }

  if (fieldConfig.type === "relationship") {
    specificProps.items = relationshipItems;
    specificProps.isLoading = relationshipLoading;
    specificProps.many = (fieldConfig as any).many || false;
  }

  return <Component {...baseProps} {...specificProps} />;
}
