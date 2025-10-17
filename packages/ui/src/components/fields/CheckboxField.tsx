"use client";

import { cn } from "../../lib/utils.js";

export interface CheckboxFieldProps {
  name: string;
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  error?: string;
  disabled?: boolean;
  mode?: "read" | "edit";
}

export function CheckboxField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  mode = "edit",
}: CheckboxFieldProps) {
  if (mode === "read") {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">
          {label}
        </label>
        <p className="text-sm">{value ? "Yes" : "No"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <input
          id={name}
          name={name}
          type="checkbox"
          checked={value || false}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className={cn(
            "h-4 w-4 rounded border-input text-primary",
            "focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-destructive",
          )}
        />
        <label
          htmlFor={name}
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          {label}
        </label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
