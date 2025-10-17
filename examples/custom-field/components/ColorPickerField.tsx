"use client";

import { cn } from "@opensaas/ui";

export interface ColorPickerFieldProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  mode?: "read" | "edit";
}

/**
 * Custom color picker field component
 * Demonstrates global field type registration
 */
export function ColorPickerField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  mode = "edit",
}: ColorPickerFieldProps) {
  if (mode === "read") {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded border border-border"
            style={{ backgroundColor: value || "#000000" }}
          />
          <span className="text-sm text-muted-foreground">
            {value || "No color selected"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor={name}
        className="text-sm font-medium text-foreground flex items-center gap-1"
      >
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={name}
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "w-16 h-10 rounded border border-input cursor-pointer",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        />
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          disabled={disabled}
          className={cn(
            "flex-1 px-3 py-2 rounded-md border border-input",
            "bg-background text-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            error && "border-destructive focus:ring-destructive",
          )}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
