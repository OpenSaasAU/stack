"use client";

import { cn } from "../../lib/utils.js";

export interface SelectFieldProps {
  name: string;
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  options: Array<{ label: string; value: string }>;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  mode?: "read" | "edit";
}

export function SelectField({
  name,
  value,
  onChange,
  label,
  options,
  error,
  disabled,
  required,
  mode = "edit",
}: SelectFieldProps) {
  if (mode === "read") {
    const selectedOption = options.find((opt) => opt.value === value);
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">
          {label}
        </label>
        <p className="text-sm">{selectedOption?.label || "-"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>
      <select
        id={name}
        name={name}
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        required={required}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive",
        )}
      >
        <option value="">Select an option...</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
